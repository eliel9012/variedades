#!/usr/bin/env node
// Servidor de produção do site (substitui o Vite dev server). Sem dependências:
// node:http + node:cluster, um processo por núcleo (WEB_WORKERS).
//
// - dist/ (build do Vite) fica em memória já comprimido (brotli e gzip);
// - /assets/* com cache imutável (nome tem hash);
// - /tse/* = espelho do TSE gravado pelo scripts/ingest-tse.mjs, lido do disco
//   a cada pedido (troca a cada poucos segundos), com cache curto pensado para
//   o Cloudflare segurar o pico: s-maxage=10 + stale-if-error;
// - /data/* lido direto de public/data (os scripts de sync regravam ali sem
//   precisar de novo build);
// - /api/* repassado para o backend de Cenários IA (127.0.0.1:8790);
// - qualquer outra rota sem extensão devolve index.html (SPA).

import cluster from 'node:cluster'
import http from 'node:http'
import { availableParallelism } from 'node:os'
import { readFile, stat, readdir } from 'node:fs/promises'
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = path.join(ROOT, 'dist')
const DATA_DIR = path.join(ROOT, 'public', 'data')
const MIRROR_DIR = process.env.TSE_MIRROR_DIR || path.join(ROOT, 'tse-mirror')
const PORT = Number(process.env.PORT || 8776)
const HOST = process.env.HOST || '127.0.0.1'
const API_TARGET = { host: '127.0.0.1', port: Number(process.env.API_PORT || 8790) }
const WORKERS = Number(process.env.WEB_WORKERS || Math.min(4, availableParallelism()))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.jws': 'application/jose; charset=utf-8',
}
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json|xml|jose)|image\/svg)/

const CACHE = {
  immutable: 'public, max-age=31536000, immutable',
  // stale-if-error longo: se esta máquina cair, o Cloudflare segue entregando o
  // site (e o front, sem espelho atualizado, busca direto no TSE).
  html: 'public, max-age=0, s-maxage=30, stale-while-revalidate=60, stale-if-error=86400',
  noCache: 'no-cache',
  data: 'public, max-age=60, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400',
  tse: 'public, max-age=5, s-maxage=10, stale-while-revalidate=20, stale-if-error=600',
  tseStatus: 'public, max-age=5, s-maxage=5, stale-if-error=86400',
  static: 'public, max-age=3600, s-maxage=3600, stale-if-error=86400',
}

function cacheFor(urlPath) {
  if (urlPath.startsWith('/assets/')) return CACHE.immutable
  if (urlPath === '/sw.js' || urlPath === '/manifest.webmanifest') return CACHE.noCache
  if (urlPath.endsWith('.html') || urlPath === '/') return CACHE.html
  return CACHE.static
}

function compressVariants(body, type) {
  if (!COMPRESSIBLE.test(type) || body.length < 512) return {}
  return {
    br: brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 } }),
    gzip: gzipSync(body, { level: 9 }),
  }
}

function makeEntry(body, type, cacheControl, mtime) {
  return {
    body,
    type,
    cacheControl,
    etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`,
    lastModified: (mtime ?? new Date()).toUTCString(),
    ...compressVariants(body, type),
  }
}

/** Carrega todo o dist/ em memória (algumas centenas de KB). */
async function loadDist() {
  const entries = new Map()
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name)
      if (item.isDirectory()) {
        await walk(full)
        continue
      }
      const rel = '/' + path.relative(DIST_DIR, full).split(path.sep).join('/')
      if (rel.startsWith('/data/')) continue // /data vem de public/data, ao vivo
      const type = MIME[path.extname(rel)] || 'application/octet-stream'
      const info = await stat(full)
      entries.set(rel, makeEntry(await readFile(full), type, cacheFor(rel), info.mtime))
    }
  }
  await walk(DIST_DIR)
  return entries
}

/** Arquivos que mudam em disco (espelho TSE, public/data): cache por mtime. */
const liveCache = new Map()
async function loadLive(baseDir, relPath, cacheControl) {
  const full = path.join(baseDir, relPath)
  if (!full.startsWith(baseDir + path.sep)) return null
  let info
  try {
    info = await stat(full)
  } catch {
    return null
  }
  if (!info.isFile()) return null
  const key = full
  const cached = liveCache.get(key)
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.entry
  const type = MIME[path.extname(full)] || 'application/octet-stream'
  const entry = makeEntry(await readFile(full), type, cacheControl, info.mtime)
  liveCache.set(key, { mtimeMs: info.mtimeMs, size: info.size, entry })
  if (liveCache.size > 2000) liveCache.delete(liveCache.keys().next().value)
  return entry
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
}

function send(req, res, entry, extraHeaders = {}) {
  const headers = {
    ...SECURITY_HEADERS,
    'content-type': entry.type,
    'cache-control': entry.cacheControl,
    etag: entry.etag,
    'last-modified': entry.lastModified,
    vary: 'Accept-Encoding',
    ...extraHeaders,
  }
  if (req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, headers)
    res.end()
    return
  }
  const accept = String(req.headers['accept-encoding'] || '')
  let body = entry.body
  if (entry.br && /\bbr\b/.test(accept)) {
    body = entry.br
    headers['content-encoding'] = 'br'
  } else if (entry.gzip && /\bgzip\b/.test(accept)) {
    body = entry.gzip
    headers['content-encoding'] = 'gzip'
  }
  headers['content-length'] = body.length
  res.writeHead(200, headers)
  res.end(req.method === 'HEAD' ? undefined : body)
}

function notFound(res) {
  res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=10' })
  res.end('Não encontrado')
}

function proxyApi(req, res) {
  const upstream = http.request(
    { ...API_TARGET, method: req.method, path: req.url, headers: { ...req.headers, host: `${API_TARGET.host}:${API_TARGET.port}` } },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, { ...upstreamRes.headers, 'cache-control': 'no-store' })
      upstreamRes.pipe(res)
    },
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ error: 'api_unavailable', detail: 'Backend de Cenários (IA) indisponível.' }))
  })
  res.on('close', () => upstream.destroy())
  req.pipe(upstream)
}

async function startWorker() {
  const dist = await loadDist()
  const indexEntry = dist.get('/index.html')
  if (!indexEntry) throw new Error('dist/index.html não existe: rode npm run build')

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://local')
      let urlPath
      try {
        urlPath = decodeURIComponent(url.pathname)
      } catch {
        notFound(res)
        return
      }
      if (urlPath.startsWith('/api/')) {
        proxyApi(req, res)
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }
      if (urlPath.includes('\0') || urlPath.split('/').includes('..')) {
        notFound(res)
        return
      }
      if (urlPath === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
        res.end('ok')
        return
      }
      if (urlPath.startsWith('/tse/')) {
        const rel = urlPath.slice('/tse/'.length)
        const entry = await loadLive(MIRROR_DIR, rel, rel === 'status.json' ? CACHE.tseStatus : CACHE.tse)
        if (entry) send(req, res, entry, { 'access-control-allow-origin': '*' })
        else notFound(res)
        return
      }
      if (urlPath.startsWith('/data/')) {
        const entry = await loadLive(DATA_DIR, urlPath.slice('/data/'.length), CACHE.data)
        if (entry) send(req, res, entry)
        else notFound(res)
        return
      }
      const entry = dist.get(urlPath === '/' ? '/index.html' : urlPath)
      if (entry) {
        send(req, res, entry)
        return
      }
      // Rota da SPA (sem extensão) -> index.html; arquivo inexistente -> 404.
      if (!path.extname(urlPath)) send(req, res, indexEntry)
      else notFound(res)
    } catch (error) {
      console.error(error)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Erro interno')
    }
  })
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 66_000
  server.requestTimeout = 30_000
  server.listen(PORT, HOST)
}

if (cluster.isPrimary && WORKERS > 1) {
  console.log(`web: ${WORKERS} workers em http://${HOST}:${PORT} (dist=${DIST_DIR}, espelho=${MIRROR_DIR})`)
  for (let i = 0; i < WORKERS; i += 1) cluster.fork()
  cluster.on('exit', (worker, code) => {
    console.error(`worker ${worker.process.pid} saiu (${code}); subindo outro`)
    setTimeout(() => cluster.fork(), 1_000)
  })
} else {
  startWorker().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
