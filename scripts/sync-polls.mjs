import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Fonte primária para Presidente: repositório aberto
// `rafaujo/eleicoes-2026-pesquisas`, que transcreve pesquisas eleitorais 2026
// publicadas por institutos/veículos e reconcilia cada uma com o registro
// oficial do TSE (protocolo, amostra, contratante) via
// `data/tse-metadata*.json`. Estrutura real verificada em 2026-10-01 (ver
// `data/elections.json`, `data/polls.json`). Hoje essa fonte só cobre a
// corrida presidencial nacional (sem corte por estado) e, para Governador,
// só São Paulo e Minas Gerais — por isso Governador usa uma fonte separada
// abaixo, com cobertura real das 27 UFs.
//
// Poder360/Volt Data Lab foi avaliado como fonte secundária, mas não expõe um
// endpoint público e sem autenticação acessível a partir deste script (a
// página do PoderData não embute nenhuma API/Flourish/Datawrapper visível sem
// JS renderizado) — por isso foi descartado por ora.
const REPO_BASE = 'https://raw.githubusercontent.com/rafaujo/eleicoes-2026-pesquisas/main'
const REPO_HOME = 'https://github.com/rafaujo/eleicoes-2026-pesquisas'
const ELECTIONS_INDEX_URL = `${REPO_BASE}/data/elections.json`

// Fonte para Governador: `thiago-salvador/puxa-ficha` (puxaficha.com.br),
// plataforma cívica de transparência eleitoral (Apache-2.0, dados públicos
// rastreáveis até a divulgação jornalística/TSE original de cada pesquisa).
// Cobre pesquisas de Governador nas 27 UFs, com cenários por turno já
// separados — verificado em 2026-10-02 (`scripts/data/pesquisas-governadores-2026.json`).
const GOV_REPO_BASE = 'https://raw.githubusercontent.com/thiago-salvador/puxa-ficha/main'
const GOV_REPO_HOME = 'https://github.com/thiago-salvador/puxa-ficha'
const GOV_DATA_URL = `${GOV_REPO_BASE}/scripts/data/pesquisas-governadores-2026.json`

const root = process.cwd()
const outputDir = join(root, 'public/data')
// Endpoints separados por cargo (antes era um único polls.json combinado):
// cada view da aba Pesquisas lê o seu próprio arquivo.
const presidenteOutputFile = join(outputDir, 'polls-presidente-nacional.json')
const governadorOutputFile = join(outputDir, 'polls-governador-estados.json')
mkdirSync(outputDir, { recursive: true })

const DAYS_WINDOW = 30
const now = new Date()
const cutoff = new Date(now.getTime() - DAYS_WINDOW * 24 * 60 * 60 * 1000)

// Cargos cobertos pelo app (docs/tse-research.md) na fonte rafaujo: só
// Presidente aqui (Governador vem da fonte puxa-ficha, mais completa).
// Qualquer outro cargo que a fonte venha a publicar (ex.: prefeito) é
// descartado automaticamente, mesmo que apareça em `elections.json`.
const SUPPORTED_OFFICES = new Set(['Presidente'])

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} ao buscar ${url}`)
  return response.json()
}

function parseIsoDate(value) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

// `poll.published` é a data de divulgação quando a fonte a registrou; quando
// ausente (comum em levantamentos mais antigos do arquivo), usamos o fim do
// período de campo (`poll.end`) como melhor data real disponível — nunca uma
// data inventada.
function effectivePublishedAt(poll) {
  return poll.published || poll.end || null
}

// A fonte publica, por pesquisa, vários cenários (1º turno com/sem candidato
// X, e um ou mais confrontos de 2º turno). O sync antigo escolhia só UM
// cenário "manchete" por pesquisa — quase sempre um de 1º turno — e descartava
// o resto, inclusive os de 2º turno. Isso tornava um filtro real de turno
// impossível (quase não sobrava dado de 2º turno). Agora escolhemos, para cada
// pesquisa, até um cenário manchete de 1º turno E um de 2º turno (quando a
// pesquisa de fato publicou um), gerando até 2 registros por pesquisa — nunca
// inventando um cenário que a pesquisa não publicou.
function pickHeadlineScenarioId(poll, scenarioById, defaultScenarioId, round) {
  const publishedIds = Object.keys(poll.scenarios || {}).filter((id) => scenarioById[id]?.round === round)
  if (publishedIds.length === 0) return null
  if (round === 1 && defaultScenarioId && publishedIds.includes(defaultScenarioId)) return defaultScenarioId
  return publishedIds[0]
}

function buildPollEntry(electionEntry, poll, scenarioId, scenarioById, metadataRecords, candidates) {
  const scenarioMeta = scenarioById[scenarioId]
  const scenarioData = poll.scenarios[scenarioId]
  if (!scenarioData || !scenarioData.results) return null

  const results = Object.entries(scenarioData.results)
    .map(([candidateKey, percentage]) => ({
      candidateName: candidates[candidateKey]?.name || candidateKey,
      // A fonte não publica partido por candidato nestes arquivos; nunca
      // inventamos um partido, então o campo fica null.
      party: null,
      percentage: typeof percentage === 'number' ? percentage : null,
    }))
    .filter((row) => row.percentage !== null)

  if (typeof scenarioData.undecided === 'number' && scenarioData.undecided > 0) {
    results.push({ candidateName: 'Indecisos/Brancos/Nulos', party: null, percentage: scenarioData.undecided })
  }
  results.sort((a, b) => b.percentage - a.percentage)
  if (results.length === 0) return null

  const publishedAt = effectivePublishedAt(poll)
  if (!publishedAt) return null

  const tseRecord = poll.protocol ? metadataRecords?.[poll.protocol] : undefined
  // `publication` no arquivo de origem é descrito no próprio template do
  // repositório ("Contratante ou veículo"). Quando o instituto divulgou a
  // pesquisa por conta própria ("Divulgação própria"), não há contratante
  // externo real a reportar, então o campo fica null em vez de repetir isso
  // como se fosse um nome de contratante.
  const commissioner = poll.publication && poll.publication !== 'Divulgação própria' ? poll.publication : null

  return {
    id: `${electionEntry.id}-${poll.id}-${scenarioId}`,
    office: electionEntry.office,
    uf: electionEntry.jurisdiction,
    institute: poll.pollster || 'Instituto não identificado',
    commissioner,
    fieldDates: poll.start && poll.end ? { start: poll.start, end: poll.end } : null,
    publishedAt,
    sampleSize: typeof poll.sample === 'number' ? poll.sample : typeof tseRecord?.sample === 'number' ? tseRecord.sample : null,
    marginOfError: typeof poll.margin === 'number' ? poll.margin : null,
    round: scenarioMeta?.round === 1 || scenarioMeta?.round === 2 ? scenarioMeta.round : null,
    scenarioLabel: scenarioMeta?.label || null,
    results,
    sourceUrl: scenarioData.resultSource || poll.resultSource || null,
  }
}

function normalizePoll(electionEntry, poll, scenarioById, metadataRecords, candidates) {
  const entries = []
  for (const round of [1, 2]) {
    const scenarioId = pickHeadlineScenarioId(poll, scenarioById, electionEntry.defaultScenario, round)
    if (!scenarioId) continue
    const entry = buildPollEntry(electionEntry, poll, scenarioId, scenarioById, metadataRecords, candidates)
    if (entry) entries.push(entry)
  }
  return entries
}

async function syncElection(electionEntry) {
  const [data, metadata] = await Promise.all([
    fetchJson(`${REPO_BASE}/${electionEntry.dataFile}`),
    electionEntry.metadataFile
      ? fetchJson(`${REPO_BASE}/${electionEntry.metadataFile}`).catch((error) => {
          console.warn(`Aviso: metadados do TSE indisponíveis para ${electionEntry.id} (${error.message}). Seguindo sem reconciliação de amostra.`)
          return null
        })
      : null,
  ])

  const scenarioById = Object.fromEntries((data.scenarios || []).map((scenario) => [scenario.id, scenario]))
  const metadataRecords = metadata?.records || null
  const candidates = data.candidates || {}

  const polls = []
  for (const poll of data.polls || []) {
    const effective = parseIsoDate(effectivePublishedAt(poll))
    if (!effective || effective < cutoff || effective > now) continue
    polls.push(...normalizePoll(electionEntry, poll, scenarioById, metadataRecords, candidates))
  }
  return polls
}

// Nomes reais usados pela fonte para "sem contratante externo" (pesquisa
// paga pelo próprio instituto, não por um veículo/partido). Tratamos como
// `null` em vez de repetir isso como se fosse o nome de um contratante.
const SELF_FUNDED_PATTERN = /pr[oó]prio|pr[oó]prios recursos|recursos pr[oó]prios/i

function buildGovernadorPollEntry(pesquisa, cenario) {
  if (!cenario.resultados || cenario.resultados.length === 0) return null

  const results = cenario.resultados
    .map((row) => ({
      candidateName: row.raw_label,
      // A fonte não publica partido por candidato neste arquivo; nunca
      // inventamos um partido, então o campo fica null (mesmo padrão da
      // fonte de Presidente).
      party: null,
      percentage: typeof row.value_percent === 'number' ? row.value_percent : null,
    }))
    .filter((row) => row.percentage !== null)
    .sort((a, b) => b.percentage - a.percentage)
  if (results.length === 0) return null

  const publishedAt = pesquisa.publication_date?.value || pesquisa.fieldwork?.end?.value || null
  if (!publishedAt) return null

  const commissionerRaw = pesquisa.contratante?.value || null
  const commissioner = commissionerRaw && !SELF_FUNDED_PATTERN.test(commissionerRaw) ? commissionerRaw : null

  const round = cenario.turn === 1 || cenario.turn === 2 ? cenario.turn : null

  return {
    id: `govff-${cenario.id}`,
    office: 'Governador',
    uf: pesquisa.geography?.code || null,
    institute: pesquisa.instituto?.value || 'Instituto não identificado',
    commissioner,
    fieldDates: pesquisa.fieldwork?.start?.value && pesquisa.fieldwork?.end?.value
      ? { start: pesquisa.fieldwork.start.value, end: pesquisa.fieldwork.end.value }
      : null,
    publishedAt,
    sampleSize: typeof pesquisa.sample?.size?.value === 'number' ? pesquisa.sample.size.value : null,
    marginOfError: typeof pesquisa.margin_error_pp?.value === 'number' ? pesquisa.margin_error_pp.value : null,
    round,
    scenarioLabel: cenario.label_raw || null,
    results,
    sourceUrl: pesquisa.provenance?.result_url || null,
  }
}

async function syncGovernadorPolls() {
  const file = await fetchJson(GOV_DATA_URL)
  const datasets = file.datasets || []
  const polls = []
  for (const dataset of datasets) {
    for (const pesquisa of dataset.pesquisas || []) {
      if (!pesquisa.uf && !pesquisa.geography?.code) continue
      for (const cenario of pesquisa.cenarios || []) {
        const publishedAt = pesquisa.publication_date?.value || pesquisa.fieldwork?.end?.value
        const effective = parseIsoDate(publishedAt)
        if (!effective || effective < cutoff || effective > now) continue
        const entry = buildGovernadorPollEntry(pesquisa, cenario)
        if (entry && entry.uf) polls.push(entry)
      }
    }
  }
  return polls
}

async function syncPresidentePolls() {
  let electionsIndex
  try {
    electionsIndex = await fetchJson(ELECTIONS_INDEX_URL)
  } catch (error) {
    console.warn(`Aviso: falha ao buscar o índice de eleições em ${ELECTIONS_INDEX_URL} (${error.message}). Pulando Presidente.`)
    return []
  }

  const elections = (electionsIndex.elections || [])
    .map((entry) => ({
      id: entry.id,
      dataFile: entry.dataFile,
      metadataFile: entry.metadataFile,
      defaultScenario: entry.defaultScenario,
      office: entry.tse?.office,
      jurisdiction: entry.tse?.jurisdiction,
    }))
    .filter((entry) => SUPPORTED_OFFICES.has(entry.office) && entry.dataFile)

  const polls = []
  for (const electionEntry of elections) {
    try {
      const entryPolls = await syncElection(electionEntry)
      polls.push(...entryPolls)
      console.log(`${electionEntry.id}: ${entryPolls.length} pesquisa(s) nos últimos ${DAYS_WINDOW} dias.`)
    } catch (error) {
      console.warn(`Aviso: não foi possível sincronizar ${electionEntry.id} (${error.message}). Pulando esta eleição.`)
    }
  }
  return polls
}

async function main() {
  const [presidentePolls, governadorPolls] = await Promise.all([
    syncPresidentePolls(),
    syncGovernadorPolls().catch((error) => {
      console.warn(`Aviso: falha ao buscar pesquisas de Governador em ${GOV_DATA_URL} (${error.message}). Pulando Governador.`)
      return []
    }),
  ])

  console.log(`governador (puxa-ficha): ${governadorPolls.length} registro(s) nos últimos ${DAYS_WINDOW} dias.`)

  presidentePolls.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0))
  governadorPolls.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0))

  writeFileSync(
    presidenteOutputFile,
    `${JSON.stringify(
      {
        generatedAt: now.toISOString(),
        source: presidentePolls.length > 0 ? REPO_HOME : null,
        polls: presidentePolls,
      },
      null,
      2,
    )}\n`,
  )

  writeFileSync(
    governadorOutputFile,
    `${JSON.stringify(
      {
        generatedAt: now.toISOString(),
        source: governadorPolls.length > 0 ? GOV_REPO_HOME : null,
        polls: governadorPolls,
      },
      null,
      2,
    )}\n`,
  )

  if (presidentePolls.length === 0 && governadorPolls.length === 0) {
    console.error('Nenhuma das fontes de pesquisa pôde ser sincronizada. Endpoints gravados vazios (sem dados inventados).')
  }

  console.log(
    `Pesquisas: ${presidentePolls.length} Presidente em public/data/polls-presidente-nacional.json, ` +
      `${governadorPolls.length} Governador em public/data/polls-governador-estados.json`,
  )
}

await main()
