#!/usr/bin/env node
// Ingest da apuração: espelha nesta máquina os arquivos oficiais do TSE
// (resultados.tse.jus.br/oficial/...) no MESMO caminho, dentro de
// tse-mirror/oficial/..., servidos pelo server/web.mjs em /tse/oficial/...
// O front lê o espelho primeiro (uma consulta ao TSE por arquivo, não importa
// quantos visitantes) e só vai direto ao TSE se o espelho estiver velho.
//
// Estabilidade contra bloqueio/limite do CDN do TSE:
// - requisição condicional (If-None-Match/If-Modified-Since): sem mudança o
//   TSE responde 304 sem corpo;
// - concorrência baixa, jitter e intervalos por prioridade (Presidente,
//   Governador e Senador mais rápido; Deputados mais devagar);
// - backoff exponencial por upstream em 403/429/5xx, com rodízio entre
//   upstreams (TSE_UPSTREAMS: lista separada por vírgula, ex. um Worker do
//   Cloudflare que repassa /oficial/* para o TSE);
// - o último arquivo bom nunca é apagado: em falha, o espelho só fica parado
//   e o status.json avisa (o front então tenta o TSE direto).
// Nunca gera número: só copia o arquivo oficial byte a byte.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIRROR_DIR = process.env.TSE_MIRROR_DIR || path.join(ROOT, 'tse-mirror')
const UPSTREAMS = (process.env.TSE_UPSTREAMS || 'https://resultados.tse.jus.br')
  .split(',')
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter(Boolean)
const CONCURRENCY = Number(process.env.TSE_CONCURRENCY || 6)
const REQUEST_TIMEOUT_MS = 15_000
const USER_AGENT = 'ApuraBrasil-ingest/1.0 (+https://eleicoes.meulab.fun)'

// Intervalos por prioridade (ms). Ajustáveis por env sem mexer no código.
const INTERVAL = {
  config: Number(process.env.TSE_INTERVAL_CONFIG || 60_000),
  fast: Number(process.env.TSE_INTERVAL_FAST || 15_000), // Presidente, Governador, Senador
  slow: Number(process.env.TSE_INTERVAL_SLOW || 60_000), // Deputados
  tracking: Number(process.env.TSE_INTERVAL_TRACKING || 30_000), // -ab (seções apuradas)
  missing: 10 * 60_000, // arquivo que deu 404: tenta de novo só depois disso
}

const UFS = ['ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to']
const FAST_OFFICES = new Set(['1', '3', '5'])
const SITE_OFFICES = new Set(['1', '3', '5', '6', '7', '8'])

/** Estado por arquivo: ETag/Last-Modified, hash do último corpo e agenda. */
const files = new Map()
const upstreamState = UPSTREAMS.map((base) => ({ base, failures: 0, blockedUntil: 0 }))
const status = {
  startedAt: new Date().toISOString(),
  lastCycleAt: null,
  lastSuccessAt: null,
  lastChangeAt: null,
  lastError: null,
  lastErrorAt: null,
  consecutiveErrors: 0,
  upstreams: upstreamState,
  files: { tracked: 0, ok: 0, missing: 0, failing: 0 },
  elections: [],
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const jitter = (ms) => Math.round(ms * (0.85 + Math.random() * 0.3))
const log = (...args) => console.log(new Date().toISOString(), ...args)

async function writeAtomic(target, data) {
  await mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, target)
}

function pickUpstream() {
  const now = Date.now()
  const available = upstreamState.filter((u) => u.blockedUntil <= now)
  if (available.length === 0) return null
  return available.sort((a, b) => a.failures - b.failures)[0]
}

function penalize(upstream, httpStatus) {
  upstream.failures += 1
  // 403/429 = provável bloqueio/limite: espera bem mais que num 5xx comum.
  const base = httpStatus === 403 || httpStatus === 429 ? 60_000 : 5_000
  const wait = Math.min(base * 2 ** Math.min(upstream.failures - 1, 5), 15 * 60_000)
  upstream.blockedUntil = Date.now() + jitter(wait)
  log(`upstream ${upstream.base} em espera por ${Math.round(wait / 1000)}s (HTTP ${httpStatus ?? 'rede'})`)
}

/** Busca um arquivo /oficial/... e grava no espelho se mudou. */
async function fetchFile(relPath) {
  const entry = files.get(relPath)
  const upstream = pickUpstream()
  if (!upstream) throw new Error('todos os upstreams em espera')
  const headers = { 'user-agent': USER_AGENT, accept: 'application/json' }
  if (entry.etag) headers['if-none-match'] = entry.etag
  if (entry.lastModified) headers['if-modified-since'] = entry.lastModified
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response
  try {
    response = await fetch(`${upstream.base}/oficial/${relPath}`, { headers, signal: controller.signal })
  } catch (error) {
    penalize(upstream, null)
    throw error
  } finally {
    clearTimeout(timer)
  }
  if (response.status === 304) {
    upstream.failures = 0
    return 'unchanged'
  }
  if (response.status === 404) {
    upstream.failures = 0
    return 'missing'
  }
  if (!response.ok) {
    if (response.status === 403 || response.status === 429 || response.status >= 500) penalize(upstream, response.status)
    throw new Error(`HTTP ${response.status} em ${relPath}`)
  }
  const body = Buffer.from(await response.arrayBuffer())
  // Nunca grava resposta que não seja JSON válido (ex.: página de erro do CDN).
  JSON.parse(body.toString('utf8'))
  upstream.failures = 0
  entry.etag = response.headers.get('etag')
  entry.lastModified = response.headers.get('last-modified')
  const hash = createHash('sha1').update(body).digest('hex')
  if (hash === entry.hash) return 'unchanged'
  entry.hash = hash
  await writeAtomic(path.join(MIRROR_DIR, 'oficial', relPath), body)
  return 'changed'
}

function track(relPath, interval) {
  if (!files.has(relPath)) files.set(relPath, { interval, nextAt: 0, state: 'new' })
  else files.get(relPath).interval = interval
}

/** Lê o config do espelho/TSE e (re)monta a lista de arquivos a acompanhar. */
function planFromConfig(config) {
  const plan = config.pl?.find((item) => item.c === 'ele2026')
  if (!plan) throw new Error('config sem ele2026')
  const elections = []
  for (const election of plan.e || []) {
    if (!election.cd) continue
    // Só os cargos que o site mostra (ignora, ex., Conselho Distrital, cd 25).
    const offices = new Set((election.abr || []).flatMap((abr) => (abr.cp || []).map((cp) => cp.cd)).filter((cd) => SITE_OFFICES.has(cd)))
    if (offices.size === 0) continue
    elections.push({ code: election.cd, t: election.t, offices: [...offices] })
    // 2º turno: o config de 1º turno já informa o código (cdt2). Só Presidente
    // e Governador podem ter 2º turno.
    if (election.t === '1' && election.cdt2) {
      const second = [...offices].filter((cd) => cd === '1' || cd === '3')
      if (second.length) elections.push({ code: election.cdt2, t: '2', offices: second, speculative: true })
    }
  }
  for (const { code, offices, speculative } of elections) {
    const code6 = code.padStart(6, '0')
    const base = `${plan.c}/${code}/dados`
    const territories = offices.includes('1') ? ['br', ...UFS] : UFS
    for (const territory of territories) {
      // Tracking (seções apuradas) por território.
      track(`${base}/${territory}/${territory}-e${code6}-ab.json`, speculative ? INTERVAL.missing : INTERVAL.tracking)
      for (const office of offices) {
        if (territory === 'br' && office !== '1') continue
        if (office === '7' && territory === 'df') continue // DF elege distrital (8), não estadual
        if (office === '8' && territory !== 'df') continue
        const interval = speculative ? INTERVAL.missing : FAST_OFFICES.has(office) ? INTERVAL.fast : INTERVAL.slow
        track(`${base}/${territory}/${territory}-c${office.padStart(4, '0')}-e${code6}-u.json`, interval)
      }
    }
  }
  status.elections = elections.map(({ code, t, offices, speculative }) => ({ code, t, offices, speculative: !!speculative }))
}

async function refreshConfig() {
  const rel = 'comum/config/ele-c.json'
  track(rel, INTERVAL.config)
  const result = await fetchFile(rel)
  files.get(rel).nextAt = Date.now() + jitter(INTERVAL.config)
  if (result === 'missing') throw new Error('config 404')
  const config = JSON.parse(await readFile(path.join(MIRROR_DIR, 'oficial', rel), 'utf8'))
  planFromConfig(config)
}

async function writeStatus() {
  let ok = 0
  let missing = 0
  let failing = 0
  for (const entry of files.values()) {
    if (entry.state === 'ok') ok += 1
    else if (entry.state === 'missing') missing += 1
    else if (entry.state === 'error') failing += 1
  }
  status.files = { tracked: files.size, ok, missing, failing }
  status.lastCycleAt = new Date().toISOString()
  await writeAtomic(path.join(MIRROR_DIR, 'status.json'), JSON.stringify(status, null, 1))
}

async function runDue() {
  const now = Date.now()
  const due = [...files.entries()].filter(([rel, entry]) => entry.nextAt <= now && rel !== 'comum/config/ele-c.json')
  let index = 0
  let changed = 0
  const worker = async () => {
    while (index < due.length) {
      const [rel, entry] = due[index++]
      try {
        const result = await fetchFile(rel)
        entry.state = result === 'missing' ? 'missing' : 'ok'
        entry.nextAt = Date.now() + jitter(result === 'missing' ? INTERVAL.missing : entry.interval)
        if (result === 'changed') changed += 1
        if (result !== 'missing') {
          status.lastSuccessAt = new Date().toISOString()
          status.consecutiveErrors = 0
        }
      } catch (error) {
        entry.state = 'error'
        entry.nextAt = Date.now() + jitter(Math.min(entry.interval, 20_000))
        status.consecutiveErrors += 1
        status.lastError = error instanceof Error ? error.message : String(error)
        status.lastErrorAt = new Date().toISOString()
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker))
  if (changed > 0) {
    status.lastChangeAt = new Date().toISOString()
    log(`${changed} arquivo(s) atualizados de ${due.length} consultados`)
  }
}

/** Resumo "quem lidera em cada UF" na corrida de Presidente, tirado dos
 * arquivos oficiais já espelhados (só escolhe o mais votado; não calcula
 * percentual, usa o pvap do próprio TSE). Usado pelo mapa ao vivo do site. */
async function writePresidenteSummary() {
  const plan = status.elections.find((election) => election.offices.includes('1') && election.t === '1' && !election.speculative)
  if (!plan) return
  const code6 = plan.code.padStart(6, '0')
  const states = {}
  for (const uf of ['br', ...UFS]) {
    try {
      const data = JSON.parse(await readFile(path.join(MIRROR_DIR, 'oficial', 'ele2026', plan.code, 'dados', uf, `${uf}-c0001-e${code6}-u.json`), 'utf8'))
      const rows = []
      for (const agr of data.carg?.[0]?.agr ?? []) for (const par of agr.par ?? []) for (const cand of par.cand ?? []) {
        if (cand.dvt && cand.dvt !== 'Válido') continue
        rows.push({ name: cand.nmu, party: par.sg, number: cand.n, votes: Number(cand.vap) || 0, share: cand.pvap, status: cand.st || null })
      }
      rows.sort((a, b) => b.votes - a.votes)
      const leader = rows[0]?.votes > 0 ? rows[0] : null
      states[uf.toUpperCase()] = { sectionsPct: data.s?.pst ?? null, updatedAt: data.dg && data.hg ? `${data.dg} ${data.hg}` : null, leader, second: leader && rows[1]?.votes > 0 ? rows[1] : null }
    } catch {
      // UF ainda sem arquivo no espelho: fica de fora do resumo.
    }
  }
  await writeAtomic(path.join(MIRROR_DIR, 'resumo-presidente.json'), JSON.stringify({ generatedAt: new Date().toISOString(), source: 'resultados.tse.jus.br (arquivos oficiais espelhados)', states }))
}

async function main() {
  log(`ingest TSE: espelho em ${MIRROR_DIR}, upstreams ${UPSTREAMS.join(', ')}`)
  let configNextAt = 0
  for (;;) {
    try {
      if (Date.now() >= configNextAt) {
        await refreshConfig()
        configNextAt = Date.now() + jitter(INTERVAL.config)
      }
      await runDue()
    } catch (error) {
      status.lastError = error instanceof Error ? error.message : String(error)
      status.lastErrorAt = new Date().toISOString()
      log('erro:', status.lastError)
      configNextAt = Date.now() + 15_000
    }
    await writeStatus().catch((error) => log('status:', error.message))
    await writePresidenteSummary().catch((error) => log('resumo:', error.message))
    await sleep(1_000)
  }
}

if (process.argv.includes('--once')) {
  await refreshConfig()
  await runDue()
  await writeStatus()
  await writePresidenteSummary()
  log(JSON.stringify(status.files))
} else {
  await main()
}
