// Resultado por município sob demanda. O espelho (scripts/ingest-tse.mjs) só
// acompanha os arquivos de Brasil e UF; os de cidade são milhares (deputados x
// 5.571 municípios passa de 1,5 GB por rodada), então só são buscados no TSE
// quando alguém abre a cidade, e ficam no disco do espelho, no mesmo caminho
// do TSE. Com o cache do Cloudflare (s-maxage=30) cada arquivo gera no máximo
// uma consulta ao TSE a cada ~30 s, não importa quantas visitas.
//
// Só o processo principal do cluster consulta o TSE (os workers pedem por
// IPC): assim pedidos iguais em voo viram uma única consulta, e a fila global
// respeita o teto de ritmo (CITY_RATE por segundo, CITY_CONCURRENCY em paralelo).
// Nada de rodízio de IP: só cache, ETag e demanda.
import { mkdir, readFile, rename, stat, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'

const UPSTREAM = (process.env.TSE_CITY_UPSTREAM || 'https://resultados.tse.jus.br').replace(/\/$/, '')
const FRESH_MS = 30_000
const MISSING_MS = 60_000 // 404 do TSE: não pergunta de novo antes disso
const CITY_RATE = Number(process.env.TSE_CITY_RATE || 20)
const CITY_CONCURRENCY = Number(process.env.TSE_CITY_CONCURRENCY || 8)
const QUEUE_MAX = 400
const TIMEOUT_MS = 8_000

export const CITY_CACHE = 'public, max-age=15, s-maxage=30, stale-while-revalidate=30, stale-if-error=600'
export const CITY_MISSING_CACHE = 'public, max-age=30, s-maxage=60'

// Cargos por eleição (2º turno incluso para quando existir).
const OFFICES = { '6257': ['0001'], '6258': ['0001'], '6259': ['0003', '0005', '0006', '0007', '0008'], '6260': ['0003'] }
const CITY_RE = /^oficial\/ele2026\/(\d{4})\/dados\/([a-z]{2})\/([a-z]{2})(\d{5})-c(\d{4})-e(\d{6})-u\.json$/

/** Parece arquivo de cidade? (só o formato; a validação completa é em validCityPath) */
export const isCityPath = (rel) => CITY_RE.test(rel)

const citiesByUf = new Map()
async function citySet(dataDir, uf) {
  if (!citiesByUf.has(uf)) {
    citiesByUf.set(
      uf,
      readFile(path.join(dataDir, 'municipios', `${uf}.json`), 'utf8')
        .then((raw) => new Set(JSON.parse(raw).map((city) => city.cd)))
        .catch(() => new Set()),
    )
  }
  return citiesByUf.get(uf)
}

/** Confere eleição, cargo, UF e município contra a lista oficial (sem proxy aberto). */
export async function validCityPath(dataDir, rel) {
  const match = CITY_RE.exec(rel)
  if (!match) return false
  const [, ele, uf, ufAgain, cd, office, ele6] = match
  if (uf !== ufAgain || ele6 !== ele.padStart(6, '0')) return false
  if (!OFFICES[ele]?.includes(office)) return false
  if (office === '0007' && uf === 'df') return false
  if (office === '0008' && uf !== 'df') return false
  return (await citySet(dataDir, uf)).has(cd)
}

// ---- processo principal: fila, ritmo e coalescência ----

const inFlight = new Map()
const etags = new Map()
const missingUntil = new Map()
const queue = []
let running = 0
let tokens = CITY_RATE
let lastRefill = Date.now()
export const cityStats = { upstream: 0, notModified: 0, coalesced: 0, rejected: 0 }

function pump() {
  const now = Date.now()
  tokens = Math.min(CITY_RATE, tokens + ((now - lastRefill) / 1000) * CITY_RATE)
  lastRefill = now
  while (queue.length && running < CITY_CONCURRENCY && tokens >= 1) {
    tokens -= 1
    running += 1
    const job = queue.shift()
    job().finally(() => {
      running -= 1
      pump()
    })
  }
  if (queue.length && running < CITY_CONCURRENCY) setTimeout(pump, Math.ceil(1000 / CITY_RATE))
}

function schedule(task) {
  if (queue.length >= QUEUE_MAX) return Promise.reject(new Error('fila cheia'))
  return new Promise((resolve, reject) => {
    queue.push(() => task().then(resolve, reject))
    pump()
  })
}

async function fetchFromTse(mirrorDir, rel) {
  const full = path.join(mirrorDir, rel)
  const headers = {}
  const etag = etags.get(rel)
  if (etag) headers['if-none-match'] = etag
  cityStats.upstream += 1
  const response = await fetch(`${UPSTREAM}/${rel}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (response.status === 304) {
    cityStats.notModified += 1
    const now = new Date()
    await utimes(full, now, now)
    return 'ok'
  }
  if (response.status === 404) {
    missingUntil.set(rel, Date.now() + MISSING_MS)
    return 'missing'
  }
  if (!response.ok) throw new Error(`TSE HTTP ${response.status}`)
  const body = Buffer.from(await response.arrayBuffer())
  JSON.parse(body.toString('utf8')) // nunca grava resposta quebrada
  await mkdir(path.dirname(full), { recursive: true })
  const tmp = `${full}.${process.pid}.tmp`
  await writeFile(tmp, body)
  await rename(tmp, full)
  if (response.headers.get('etag')) etags.set(rel, response.headers.get('etag'))
  return 'ok'
}

/**
 * Garante o arquivo da cidade fresco no disco. Devolve 'ok' (arquivo no disco,
 * fresco ou, se o TSE falhar, o último que houver), 'missing' (404 no TSE) ou
 * 'error' (TSE falhou e não há cópia). Só roda no processo principal.
 */
export async function ensureCityFile(mirrorDir, rel) {
  const full = path.join(mirrorDir, rel)
  let info = null
  try {
    info = await stat(full)
  } catch {}
  if (info && Date.now() - info.mtimeMs < FRESH_MS) return 'ok'
  if (!info && (missingUntil.get(rel) ?? 0) > Date.now()) return 'missing'
  if (inFlight.has(rel)) {
    cityStats.coalesced += 1
    return inFlight.get(rel)
  }
  const promise = schedule(() => fetchFromTse(mirrorDir, rel))
    .catch((error) => {
      if (error.message === 'fila cheia') cityStats.rejected += 1
      return info ? 'ok' : 'error'
    })
    .finally(() => inFlight.delete(rel))
  inFlight.set(rel, promise)
  return promise
}

// ---- IPC entre workers e principal ----

/** No principal: atende os pedidos dos workers. */
export function serveCityRequests(cluster, mirrorDir) {
  cluster.on('message', (worker, message) => {
    if (message?.type !== 'city-file') return
    ensureCityFile(mirrorDir, message.rel).then((result) => {
      if (worker.isConnected()) worker.send({ type: 'city-file-done', id: message.id, result })
    })
  })
}

let nextId = 0
const pending = new Map()

/** No worker: pede ao principal (ou resolve direto se não houver cluster). */
export function requestCityFile(cluster, mirrorDir, rel) {
  if (!cluster.isWorker) return ensureCityFile(mirrorDir, rel)
  if (pending.size === 0 && !requestCityFile.listening) {
    process.on('message', (message) => {
      if (message?.type !== 'city-file-done') return
      pending.get(message.id)?.(message.result)
      pending.delete(message.id)
    })
    requestCityFile.listening = true
  }
  const id = ++nextId
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve('error')
    }, TIMEOUT_MS * 3)
    pending.set(id, (result) => {
      clearTimeout(timer)
      resolve(result)
    })
    process.send({ type: 'city-file', id, rel })
  })
}
