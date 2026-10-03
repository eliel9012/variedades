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

// Uma config em cache por origem (espelho local ou TSE direto).
const configCache = new Map<string, { promise: Promise<TSEConfig>; loadedAt: number }>()
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

async function fetchOfficial<T>(baseUrl: string, signal?: AbortSignal, jsonOnly = false): Promise<T> {
  const stem = baseUrl.replace(/\.(?:jws|json)$/, '')
  let lastError: unknown
  for (const extension of jsonOnly ? ['.json'] : ['.jws', '.json']) {
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
function loadConfig(source: OfficialSource): Promise<TSEConfig> {
  const cached = configCache.get(source.root)
  if (cached && Date.now() - cached.loadedAt <= CONFIG_TTL_MS) return cached.promise
  const promise = fetchOfficial<TSEConfig>(source.configUrl, undefined, source.jsonOnly).catch((error) => {
    configCache.delete(source.root)
    throw error
  })
  configCache.set(source.root, { promise, loadedAt: Date.now() })
  return promise
}

function invalidateConfig(source: OfficialSource) {
  configCache.delete(source.root)
}

// Origens dos arquivos oficiais. O espelho local (/tse/oficial, gravado pelo
// scripts/ingest-tse.mjs nesta máquina) tem os mesmos caminhos do TSE e vem
// primeiro: uma consulta ao TSE por arquivo, não importa quantos visitantes.
// Se o espelho estiver parado (status.json sem sucesso recente) ou falhar,
// o navegador vai direto ao TSE, como antes.
type OfficialSource = { root: string; configUrl: string; jsonOnly: boolean; label: string }
const TSE_SOURCE: OfficialSource = { root: new URL(CONFIG_URL).href.split('/comum/')[0], configUrl: CONFIG_URL, jsonOnly: false, label: 'tse' }
const MIRROR_ROOT = '/tse/oficial'
const MIRROR_MAX_STALE_MS = 2 * 60_000
const MIRROR_CHECK_MS = 30_000
let mirrorCheck: { at: number; ok: boolean } | null = null

function mirrorSource(): OfficialSource {
  const root = `${window.location.origin}${MIRROR_ROOT}`
  return { root, configUrl: `${root}/comum/config/ele-c.json`, jsonOnly: true, label: 'espelho' }
}

async function mirrorUsable(signal?: AbortSignal) {
  if (mirrorCheck && Date.now() - mirrorCheck.at < MIRROR_CHECK_MS) return mirrorCheck.ok
  let ok = false
  try {
    const status = await fetchJson<{ lastSuccessAt?: string | null }>('/tse/status.json', signal)
    const last = status.lastSuccessAt ? Date.parse(status.lastSuccessAt) : NaN
    ok = Number.isFinite(last) && Date.now() - last < MIRROR_MAX_STALE_MS
  } catch {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  }
  mirrorCheck = { at: Date.now(), ok }
  return ok
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


function padElection(code: string) {
  return code.padStart(6, '0')
}

type TSECandidate = { sqcand?: string; vap?: string; pvap?: string; pvapn?: string; nmu?: string; nm?: string; n?: string; st?: string; dvt?: string }
type TSEParty = { sg?: string; cand?: TSECandidate[] }

const toNumber = (value: unknown) => Number(String(value ?? '').replace(',', '.')) || 0

function candidateRow(candidate: TSECandidate, party?: string): ResultRow {
  return {
    candidateId: String(candidate.sqcand),
    votes: toNumber(candidate.vap),
    share: toNumber(candidate.pvapn ?? candidate.pvap),
    name: candidate.nmu || candidate.nm || undefined,
    number: candidate.n || undefined,
    party: party || undefined,
    status: candidate.st || undefined,
    voteDestination: candidate.dvt || undefined,
  }
}

// Formato do TSE: carg[].agr[] (coligação/federação) > par[] (partido) > cand[].
// O vice (cand[].vs[]) também tem sqcand mas não tem votos, então não entra.
function collectCandidateRows(carg: unknown): ResultRow[] {
  const rows: ResultRow[] = []
  for (const cargo of Array.isArray(carg) ? carg : []) {
    for (const agr of (cargo as { agr?: Array<{ par?: TSEParty[] }> }).agr ?? []) {
      for (const par of agr.par ?? []) {
        for (const candidate of par.cand ?? []) {
          if (typeof candidate.sqcand === 'string' && candidate.vap !== undefined) rows.push(candidateRow(candidate, par.sg))
        }
      }
    }
  }
  return rows
}

type TSESections = { st?: string; ts?: string }

function parseOfficial(result: TSEResult, tracking: TSETracking | null, scope: string, round: 1 | 2, office: string, source: string, snapshotScope = scope): ResultSnapshot {
  const rows = collectCandidateRows(result.carg).sort((left, right) => right.votes - left.votes)
  const territory = scope === 'BR' ? 'br' : scope.toLowerCase()
  // Totais oficiais do próprio arquivo do território (s = seções, v.vv = votos
  // válidos). O -ab traz o território E suas partes (UFs no BR, municípios na
  // UF): somar tudo contava as seções em dobro.
  const resultSections = (result as { s?: TSESections }).s
  const trackingRow = tracking?.abr?.find((row) => row.cdabr === territory)
  const sections = resultSections ?? trackingRow?.s
  const validVotes = (result as { v?: { vv?: string } }).v?.vv
  const totalVotes = validVotes !== undefined ? toNumber(validVotes) : rows.filter((row) => row.voteDestination !== 'Anulado').reduce((sum, row) => sum + row.votes, 0)
  const updatedAt = tseDateTimeToIso(result.dg, result.hg) ?? tseDateTimeToIso(tracking?.dg, tracking?.hg)
  return {
    election: 'Eleições Gerais 2026',
    round,
    scope: snapshotScope,
    office,
    updatedAt,
    totalVotes,
    countedSections: toNumber(sections?.st),
    totalSections: toNumber(sections?.ts),
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

// Município: mesmo diretório da UF, nome do arquivo com `{uf}{cd}` (código
// TSE de 5 dígitos). O arquivo da cidade já traz `s` (seções), então o -ab
// não é baixado. O snapshot sai com escopo `{UF}-{cd}` para nunca se misturar
// com o recorte da UF no cache/deduplicação.
export type TSECity = { cd: string }

export function cityScope(uf: string, cd: string) {
  return `${uf.toUpperCase()}-${cd}`
}

async function fetchFromSource(source: OfficialSource, effectiveRound: 1 | 2, scope: string, office: string, signal?: AbortSignal, city?: TSECity) {
  const config = await loadConfig(source)
  let election: ReturnType<typeof chooseElection>
  try {
    election = chooseElection(config, effectiveRound, office)
  } catch (error) {
    // Config sem a eleição pedida pode estar desatualizada: força recarga.
    invalidateConfig(source)
    throw error
  }
  const code = padElection(election.code)
  const officeCode = String(officeCodes[office as keyof typeof officeCodes] || 3).padStart(4, '0')
  const territory = scope === 'BR' ? 'br' : scope.toLowerCase()
  const fileStem = city ? `${territory}${city.cd}` : territory
  const resultUrl = `${source.root}/${election.cycle}/${election.code}/dados/${territory}/${fileStem}-c${officeCode}-e${code}-u`
  if (city) {
    const result = await fetchOfficial<TSEResult>(resultUrl, signal, source.jsonOnly)
    return parseOfficial(result, null, scope, effectiveRound, office, resultUrl, cityScope(scope, city.cd))
  }
  const trackingUrl = `${source.root}/${election.cycle}/${election.code}/dados/${territory}/${territory}-e${code}-ab`
  const [result, tracking] = await Promise.all([
    fetchOfficial<TSEResult>(resultUrl, signal, source.jsonOnly),
    fetchOfficial<TSETracking>(trackingUrl, signal, source.jsonOnly).catch(() => null),
  ])
  return parseOfficial(result, tracking, scope, effectiveRound, office, resultUrl)
}

export async function fetchTSESnapshot(round: 1 | 2, scope: string, office: string, signal?: AbortSignal, city?: TSECity) {
  const effectiveRound = canHaveSecondRound(office) ? round : 1
  try {
    if (office !== 'Presidente' && scope === 'BR') throw new Error('TSE UF required')
    if (city && (scope === 'BR' || !/^\d{5}$/.test(city.cd))) throw new Error('TSE city invalid')
    const sources = (await mirrorUsable(signal)) ? [mirrorSource(), TSE_SOURCE] : [TSE_SOURCE]
    let lastError: unknown
    for (const source of sources) {
      try {
        return await fetchFromSource(source, effectiveRound, scope, office, signal, city)
      } catch (error) {
        if (signal?.aborted) throw error
        lastError = error
        // Espelho falhou para este recorte: marca para reavaliar no próximo
        // ciclo e tenta o TSE direto agora.
        if (source.label === 'espelho') mirrorCheck = null
      }
    }
    throw lastError instanceof Error ? lastError : new Error('TSE unavailable')
  } catch (error) {
    // Um abort vindo do chamador (ex.: troca de filtro) é um cancelamento
    // normal: não dispara a tentativa de fallback local (que seria abortada
    // de qualquer forma) e não deve virar um erro de sincronização.
    if (signal?.aborted) throw error
    // latest.json só descreve UF/BR: não serve de fallback para cidade.
    if (city) throw error instanceof Error ? error : new Error('TSE unavailable')
    try {
      const fallback = await readLocalSnapshot(effectiveRound, scope, office, signal)
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
