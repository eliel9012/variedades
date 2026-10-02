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
      abr?: Array<{ cd?: string; cp?: Array<{ cd?: string }> }>
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
let configLoadedAt = 0
// A config do TSE muda ao longo do pleito (ex.: publicação do 2º turno), então
// não pode ficar em memória para sempre: expira depois de alguns minutos.
const CONFIG_TTL_MS = 5 * 60_000

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
    .finally(() => {
      window.clearTimeout(timeout)
      signal?.removeEventListener('abort', abortFromCaller)
    })
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

// A configuração (`ele-c.jws`) é compartilhada por todos os chamadores
// (polling de qualquer turno/escopo/cargo). Ela nunca deve ficar amarrada ao
// AbortSignal de um chamador específico: abortar uma requisição (ex.: troca
// de filtro) não pode poluir/rejeitar a configuração para outros pollings
// concorrentes ou futuros. O `request()` interno já aplica seu próprio
// timeout, então a config ainda falha rápido em caso de rede fora do ar. Se a
// promessa for rejeitada, `configPromise` volta a `null` para que a próxima
// chamada tente novamente. Mesmo resolvida, expira após CONFIG_TTL_MS.
function loadConfig(): Promise<TSEConfig> {
  if (configPromise && Date.now() - configLoadedAt > CONFIG_TTL_MS) configPromise = null
  if (!configPromise) {
    configLoadedAt = Date.now()
    configPromise = fetchOfficial<TSEConfig>(CONFIG_URL).catch((error) => {
      configPromise = null
      throw error
    })
  }
  return configPromise
}

function invalidateConfig() {
  configPromise = null
}

// TSE publica `dg` como "dd/mm/aaaa" e `hg` como "hh:mm:ss", no horário de
// Brasília. `Date.parse("dd/mm/aaaa ...")` interpreta como mm/dd (NaN para
// dia > 12), então monta um ISO explícito com offset -03:00.
export function tseDateTimeToIso(dg: string | undefined, hg: string | undefined): string | null {
  if (!dg || !hg) return null
  const date = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dg.trim())
  const time = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(hg.trim())
  if (!date || !time) return null
  const [, day, month, year] = date
  const [, hour, minute, second = '00'] = time
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

// Plano B quando o config não lista cargos: no ele-c.json real de 2026
// (conferido em 02/10/2026) a eleição "Federal" (tp 8, cd 6257/6258) tem só
// Presidente, e a "Estadual" (tp 1, cd 6259/6260) tem Governador, Senador,
// Deputado federal, estadual e distrital.
const FEDERAL_CYCLE_OFFICES = new Set(['Presidente'])
const ESTADUAL_CYCLE_OFFICES = new Set(['Governador', 'Senador', 'Deputado federal', 'Deputado estadual', 'Deputado distrital'])

function officeType(office: string) {
  if (FEDERAL_CYCLE_OFFICES.has(office)) return '8'
  if (ESTADUAL_CYCLE_OFFICES.has(office)) return '1'
  throw new Error(`TSE unknown office cycle: ${office}`)
}

function chooseElection(config: TSEConfig, round: 1 | 2, office: string) {
  const plan = config.pl?.find((item) => item.c === 'ele2026') || config.pl?.[0]
  if (plan?.c && plan.c !== 'ele2026') throw new Error('TSE 2026 election unavailable')
  const elections = plan?.e || []
  // O próprio config lista os cargos de cada eleição (abr[].cp[].cd). No
  // config real de 2026 a eleição "Federal" (6257) só tem Presidente, e
  // Senador/Deputado federal vêm na "Estadual" (6259) junto com Governador:
  // por isso o cargo manda, e o tipo (tp) fica só como plano B.
  const officeCode = String(officeCodes[office as keyof typeof officeCodes] ?? '')
  const hasOffice = (election: (typeof elections)[number]) => !!election.abr?.some((abr) => abr.cp?.some((cp) => cp.cd === officeCode))
  const byOffice = elections.find((election) => election.t === '1' && hasOffice(election))
  if (byOffice?.cd) {
    if (round === 1) return { cycle: plan?.c || 'ele2026', code: byOffice.cd }
    if (byOffice.cdt2) return { cycle: plan?.c || 'ele2026', code: byOffice.cdt2 }
  }
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

function parseOfficial(result: TSEResult, tracking: TSETracking | null, scope: string, round: 1 | 2, office: string, source: string): ResultSnapshot {
  const rows = collectCandidateRows(result.carg).sort((left, right) => right.votes - left.votes)
  const totalVotes = rows.reduce((sum, row) => sum + row.votes, 0)
  const trackingRows = tracking?.abr || []
  const countedSections = trackingRows.reduce((sum, row) => sum + (Number(row.s?.st) || 0), 0)
  const totalSections = trackingRows.reduce((sum, row) => sum + (Number(row.s?.ts) || 0), 0)
  const updatedAt = tseDateTimeToIso(result.dg, result.hg) ?? tseDateTimeToIso(tracking?.dg, tracking?.hg)
  return {
    election: 'Eleições Gerais 2026',
    round,
    scope,
    office,
    updatedAt,
    totalVotes,
    countedSections,
    totalSections,
    rows,
    status: 'official',
    source,
  }
}

// O latest.json local descreve um único recorte: só serve de fallback se for
// exatamente o recorte pedido (nunca reetiquetar números de outra UF/turno).
async function readLocalSnapshot(round: 1 | 2, scope: string, office: string, signal?: AbortSignal) {
  const local = await fetchJson<ResultSnapshot>('/data/results/latest.json', signal)
  if (local.scope !== scope || local.round !== round || (local.office != null && local.office !== office)) throw new Error('TSE local snapshot mismatch')
  return { ...local, office, status: local.status === 'official' ? 'official' : 'waiting' } satisfies ResultSnapshot
}

export async function fetchTSESnapshot(round: 1 | 2, scope: string, office: string, signal?: AbortSignal) {
  try {
    const effectiveRound = canHaveSecondRound(office) ? round : 1
    if (office !== 'Presidente' && scope === 'BR') throw new Error('TSE UF required')
    const config = await loadConfig()
    let election: ReturnType<typeof chooseElection>
    try {
      election = chooseElection(config, effectiveRound, office)
    } catch (error) {
      // Config sem a eleição pedida pode estar desatualizada: força recarga.
      invalidateConfig()
      throw error
    }
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
    return parseOfficial(result, tracking, scope, effectiveRound, office, resultUrl)
  } catch (error) {
    // Um abort vindo do chamador (ex.: troca de filtro) é um cancelamento
    // normal: não dispara a tentativa de fallback local (que seria abortada
    // de qualquer forma) e não deve virar um erro de sincronização.
    if (signal?.aborted) throw error
    try {
      const fallback = await readLocalSnapshot(canHaveSecondRound(office) ? round : 1, scope, office, signal)
      if (fallback.status === 'official') return fallback
    } catch (fallbackError) {
      // O fetch de fallback também é abortável; se foi cancelado, propaga
      // isso como cancelamento em vez de mascarar como falha de rede.
      if (signal?.aborted) throw fallbackError
    }
    throw error instanceof Error ? error : new Error('TSE unavailable')
  }
}

export const tseSources = { config: CONFIG_URL }
