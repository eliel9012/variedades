import type { ResultRow, ResultSnapshot } from './types'
import { canHaveSecondRound, officeCodes } from './data'

const CONFIG_URL = import.meta.env.VITE_TSE_RESULTS_CONFIG_URL || 'https://resultados.tse.jus.br/oficial/comum/config/ele-c.jws'
const REQUEST_TIMEOUT_MS = 8_000

type TSEConfig = {
  pl?: Array<{
    c?: string
    e?: Array<{
      cd?: string
      cdt2?: string
      t?: string
      tp?: string
    }>
  }>
}

type TSEResult = {
  ele?: string
  dg?: string
  hg?: string
  carg?: unknown[]
}

type TSETracking = {
  dg?: string
  hg?: string
  abr?: Array<{
    cdabr?: string
    s?: { ts?: string; st?: string }
  }>
}

let configPromise: Promise<TSEConfig> | null = null

function request(url: string, signal?: AbortSignal) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const abortFromCaller = () => controller.abort()
  signal?.addEventListener('abort', abortFromCaller, { once: true })
  return fetch(url, { signal: controller.signal, cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`TSE ${response.status}`)
      return response
    })
    .finally(() => window.clearTimeout(timeout))
}

function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return request(url, signal).then((response) => response.json() as Promise<T>)
}

function decodeJws<T>(raw: string): T {
  const [encodedHeader, encodedPayload, signature] = raw.trim().split('.')
  if (!encodedHeader || !encodedPayload || !signature) throw new Error('TSE JWS inválido')
  const header = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encodedHeader.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - encodedHeader.length % 4) % 4)), (char) => char.charCodeAt(0)))) as { alg?: string }
  if (header.alg !== 'EdDSA') throw new Error('TSE JWS alg inválido')
  const payload = encodedPayload.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - encodedPayload.length % 4) % 4)
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), (char) => char.charCodeAt(0)))) as T
}

function fetchJws<T>(url: string, signal?: AbortSignal): Promise<T> {
  return request(url, signal).then((response) => response.text()).then(decodeJws<T>)
}

async function fetchOfficial<T>(baseUrl: string, signal?: AbortSignal): Promise<T> {
  const stem = baseUrl.replace(/\.(?:jws|json)$/, '')
  let lastError: unknown
  for (const extension of ['.jws', '.json']) {
    try {
      return extension === '.jws' ? await fetchJws<T>(`${stem}${extension}`, signal) : await fetchJson<T>(`${stem}${extension}`, signal)
    } catch (error) {
      lastError = error
      if (!(error instanceof Error) || !error.message.includes('TSE 404')) throw error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('TSE unavailable')
}

function loadConfig(signal?: AbortSignal) {
  if (!configPromise) {
    configPromise = fetchOfficial<TSEConfig>(CONFIG_URL, signal).catch((error) => {
      configPromise = null
      throw error
    })
  }
  return configPromise
}

function officeType(office: string) {
  return office === 'Presidente' ? '8' : '1'
}

function chooseElection(config: TSEConfig, round: 1 | 2, office: string) {
  const plan = config.pl?.find((item) => item.c === 'ele2026') || config.pl?.[0]
  if (plan?.c && plan.c !== 'ele2026') throw new Error('TSE 2026 election unavailable')
  const elections = plan?.e || []
  const type = officeType(office)
  const direct = elections.find((election) => election.t === String(round) && election.tp === type)
  if (direct?.cd) return { cycle: plan?.c || 'ele2026', code: direct.cd }
  const firstTurn = elections.find((election) => election.t === '1' && election.tp === type)
  if (round === 2 && firstTurn?.cdt2) return { cycle: plan?.c || 'ele2026', code: firstTurn.cdt2 }
  if (firstTurn?.cd) return { cycle: plan?.c || 'ele2026', code: firstTurn.cd }
  throw new Error('TSE election unavailable')
}

function officialRoot() {
  return new URL(CONFIG_URL).href.split('/comum/')[0]
}

function padElection(code: string) {
  return code.padStart(6, '0')
}

function collectCandidateRows(value: unknown, rows: ResultRow[] = []) {
  if (!value || typeof value !== 'object') return rows
  if (Array.isArray(value)) {
    value.forEach((item) => collectCandidateRows(item, rows))
    return rows
  }
  const record = value as Record<string, unknown>
  if (typeof record.sqcand === 'string' && record.vap !== undefined) {
    rows.push({
      candidateId: record.sqcand,
      votes: Number(String(record.vap).replace(',', '.')) || 0,
      share: Number(String(record.pvapn ?? record.pvap ?? 0).replace(',', '.')) || 0,
    })
  }
  Object.values(record).forEach((item) => collectCandidateRows(item, rows))
  return rows
}

function parseOfficial(result: TSEResult, tracking: TSETracking | null, scope: string, round: 1 | 2, source: string): ResultSnapshot {
  const rows = collectCandidateRows(result.carg).sort((left, right) => right.votes - left.votes)
  const totalVotes = rows.reduce((sum, row) => sum + row.votes, 0)
  const trackingRows = tracking?.abr || []
  const countedSections = trackingRows.reduce((sum, row) => sum + (Number(row.s?.st) || 0), 0)
  const totalSections = trackingRows.reduce((sum, row) => sum + (Number(row.s?.ts) || 0), 0)
  const updatedAt = result.dg && result.hg ? `${result.dg} ${result.hg}` : tracking?.dg && tracking.hg ? `${tracking.dg} ${tracking.hg}` : null
  return {
    election: 'Eleições Gerais 2026',
    round,
    scope,
    updatedAt,
    totalVotes,
    countedSections,
    totalSections,
    rows,
    status: 'official',
    source,
  }
}

async function readLocalSnapshot(round: 1 | 2, scope: string, signal?: AbortSignal) {
  const local = await fetchJson<ResultSnapshot>('/data/results/latest.json', signal)
  return { ...local, round, scope, status: local.status === 'official' ? 'official' : 'waiting' } satisfies ResultSnapshot
}

export async function fetchTSESnapshot(round: 1 | 2, scope: string, office: string, signal?: AbortSignal) {
  try {
    const effectiveRound = canHaveSecondRound(office) ? round : 1
    if (office !== 'Presidente' && scope === 'BR') throw new Error('TSE UF required')
    const config = await loadConfig(signal)
    const election = chooseElection(config, effectiveRound, office)
    const code = padElection(election.code)
    const root = officialRoot()
    const officeCode = String(officeCodes[office as keyof typeof officeCodes] || 3).padStart(4, '0')
    const territory = scope === 'BR' ? 'br' : scope.toLowerCase()
    const resultUrl = `${root}/${election.cycle}/${election.code}/dados/${territory}/${territory}-c${officeCode}-e${code}-u`
    const trackingTerritory = territory === 'br' ? 'br' : territory
    const trackingUrl = `${root}/${election.cycle}/${election.code}/dados/${trackingTerritory}/${trackingTerritory}-e${code}-ab`
    const [result, tracking] = await Promise.all([
      fetchOfficial<TSEResult>(resultUrl, signal),
      fetchOfficial<TSETracking>(trackingUrl, signal).catch(() => null),
    ])
    return parseOfficial(result, tracking, scope, effectiveRound, resultUrl)
  } catch (error) {
    const fallback = await readLocalSnapshot(canHaveSecondRound(office) ? round : 1, scope)
    if (fallback.status === 'official') return fallback
    throw error instanceof Error ? error : new Error('TSE unavailable')
  }
}

export const tseSources = { config: CONFIG_URL }
