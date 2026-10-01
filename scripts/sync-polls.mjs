import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Fonte primária: repositório aberto `rafaujo/eleicoes-2026-pesquisas`, que
// transcreve pesquisas eleitorais 2026 publicadas por institutos/veículos e
// reconcilia cada uma com o registro oficial do TSE (protocolo, amostra,
// contratante) via `data/tse-metadata*.json`. Estrutura real verificada em
// 2026-10-01 (ver `data/elections.json`, `data/polls.json`,
// `data/polls-sp-governor.json`, `data/polls-mg-governor.json`).
//
// Poder360/Volt Data Lab foi avaliado como fonte secundária, mas não expõe um
// endpoint público e sem autenticação acessível a partir deste script (a
// página do PoderData não embute nenhuma API/Flourish/Datawrapper visível sem
// JS renderizado) — por isso foi descartado por ora, e este sync depende
// apenas da fonte primária acima.
const REPO_BASE = 'https://raw.githubusercontent.com/rafaujo/eleicoes-2026-pesquisas/main'
const REPO_HOME = 'https://github.com/rafaujo/eleicoes-2026-pesquisas'
const ELECTIONS_INDEX_URL = `${REPO_BASE}/data/elections.json`

const root = process.cwd()
const outputDir = join(root, 'public/data')
const outputFile = join(outputDir, 'polls.json')
mkdirSync(outputDir, { recursive: true })

const DAYS_WINDOW = 30
const now = new Date()
const cutoff = new Date(now.getTime() - DAYS_WINDOW * 24 * 60 * 60 * 1000)

// Cargos cobertos pelo app (docs/tse-research.md): Presidente e Governador
// nesta aba. Qualquer outro cargo que a fonte venha a publicar (ex.: prefeito)
// é descartado automaticamente aqui, mesmo que apareça em `elections.json`.
const SUPPORTED_OFFICES = new Set(['Presidente', 'Governador'])

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

// Escolhe o cenário "manchete" de uma pesquisa: o cenário padrão da eleição
// (`defaultScenario`, ex. "first-main") quando a pesquisa o publicou; senão o
// primeiro cenário de 1º turno que ela de fato publicou; senão, na ausência
// de qualquer cenário de 1º turno, o primeiro cenário publicado (ex.: pesquisa
// que só testou um confronto de 2º turno).
function pickHeadlineScenarioId(poll, scenarioById, defaultScenarioId) {
  const publishedIds = Object.keys(poll.scenarios || {})
  if (publishedIds.length === 0) return null
  if (defaultScenarioId && publishedIds.includes(defaultScenarioId)) return defaultScenarioId
  const firstRound = publishedIds.find((id) => scenarioById[id]?.round === 1)
  if (firstRound) return firstRound
  return publishedIds[0]
}

function normalizePoll(electionEntry, poll, scenarioById, metadataRecords, candidates) {
  const scenarioId = pickHeadlineScenarioId(poll, scenarioById, electionEntry.defaultScenario)
  if (!scenarioId) return null
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
    id: `${electionEntry.id}-${poll.id}`,
    office: electionEntry.office,
    uf: electionEntry.jurisdiction,
    institute: poll.pollster || 'Instituto não identificado',
    commissioner,
    fieldDates: poll.start && poll.end ? { start: poll.start, end: poll.end } : null,
    publishedAt,
    sampleSize: typeof poll.sample === 'number' ? poll.sample : typeof tseRecord?.sample === 'number' ? tseRecord.sample : null,
    marginOfError: typeof poll.margin === 'number' ? poll.margin : null,
    round: scenarioMeta?.round === 1 || scenarioMeta?.round === 2 ? scenarioMeta.round : null,
    results,
    sourceUrl: scenarioData.resultSource || poll.resultSource || null,
  }
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
    const normalized = normalizePoll(electionEntry, poll, scenarioById, metadataRecords, candidates)
    if (normalized) polls.push(normalized)
  }
  return polls
}

async function main() {
  let electionsIndex
  try {
    electionsIndex = await fetchJson(ELECTIONS_INDEX_URL)
  } catch (error) {
    console.error(`Falha ao buscar o índice de eleições em ${ELECTIONS_INDEX_URL}: ${error.message}`)
    console.error('Fonte indisponível a partir deste ambiente — gravando public/data/polls.json vazio (sem dados inventados).')
    writeFileSync(outputFile, `${JSON.stringify({ generatedAt: now.toISOString(), source: null, polls: [] }, null, 2)}\n`)
    return
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
    // Mantém só Presidente/Governador (escopo desta aba); descarta qualquer
    // outro cargo que a fonte venha a publicar (ex.: prefeito/vereador).
    .filter((entry) => SUPPORTED_OFFICES.has(entry.office) && entry.dataFile)

  if (elections.length === 0) {
    console.error('Índice de eleições não contém nenhuma disputa de Presidente/Governador reconhecível. Gravando polls.json vazio.')
    writeFileSync(outputFile, `${JSON.stringify({ generatedAt: now.toISOString(), source: null, polls: [] }, null, 2)}\n`)
    return
  }

  const allPolls = []
  let successfulElections = 0
  for (const electionEntry of elections) {
    try {
      const polls = await syncElection(electionEntry)
      allPolls.push(...polls)
      successfulElections += 1
      console.log(`${electionEntry.id}: ${polls.length} pesquisa(s) nos últimos ${DAYS_WINDOW} dias.`)
    } catch (error) {
      console.warn(`Aviso: não foi possível sincronizar ${electionEntry.id} (${error.message}). Pulando esta eleição.`)
    }
  }

  if (successfulElections === 0) {
    console.error('Nenhuma eleição pôde ser sincronizada a partir da fonte. Gravando polls.json vazio (sem dados inventados).')
    writeFileSync(outputFile, `${JSON.stringify({ generatedAt: now.toISOString(), source: null, polls: [] }, null, 2)}\n`)
    return
  }

  allPolls.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0))

  writeFileSync(
    outputFile,
    `${JSON.stringify(
      {
        generatedAt: now.toISOString(),
        source: REPO_HOME,
        polls: allPolls,
      },
      null,
      2,
    )}\n`,
  )

  console.log(`Pesquisas: ${allPolls.length} registro(s) de ${successfulElections}/${elections.length} eleição(ões) gravado(s) em public/data/polls.json`)
}

await main()
