import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Fonte primária para Presidente: repositório aberto
// `rafaujo/eleicoes-2026-pesquisas`, que transcreve pesquisas eleitorais 2026
// publicadas por institutos/veículos e reconcilia cada uma com o registro
// oficial do TSE (protocolo, amostra, contratante) via
// `data/tse-metadata*.json`. Estrutura real verificada em 2026-10-01 (ver
// `data/elections.json`, `data/polls.json`). Hoje essa fonte só cobre a
// corrida presidencial nacional (sem corte por estado) e, para Governador,
// só São Paulo e Minas Gerais, por isso Governador usa uma fonte separada
// abaixo, com cobertura real das 27 UFs.
//
// Poder360/Volt Data Lab foi avaliado como fonte secundária, mas não expõe um
// endpoint público e sem autenticação acessível a partir deste script (a
// página do PoderData não embute nenhuma API/Flourish/Datawrapper visível sem
// JS renderizado), por isso foi descartado por ora.
const REPO_BASE = 'https://raw.githubusercontent.com/rafaujo/eleicoes-2026-pesquisas/main'
const REPO_HOME = 'https://github.com/rafaujo/eleicoes-2026-pesquisas'
const ELECTIONS_INDEX_URL = `${REPO_BASE}/data/elections.json`

// Fonte para Governador: `thiago-salvador/puxa-ficha` (puxaficha.com.br),
// plataforma cívica de transparência eleitoral (Apache-2.0, dados públicos
// rastreáveis até a divulgação jornalística/TSE original de cada pesquisa).
// Cobre pesquisas de Governador nas 27 UFs, com cenários por turno já
// separados, verificado em 2026-10-02 (`scripts/data/pesquisas-governadores-2026.json`).
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

// 400 dias cobre toda a corrida 2026 (fontes reais começam em jun/2026 pra
// Presidente e jul/2026 pra Governador, verificado em 2026-10-02) sem
// truncar a linha do tempo de pesquisas. A UI mostra o "quadro atual" como
// um recorte recente desse histórico completo, não um reflexo direto deste
// número (ver `RECENT_WINDOW_DAYS` em pesquisas-tracker.tsx).
const DAYS_WINDOW = 400
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
// período de campo (`poll.end`) como melhor data real disponível, nunca uma
// data inventada.
function effectivePublishedAt(poll) {
  return poll.published || poll.end || null
}

// A fonte publica, por pesquisa, vários cenários (1º turno com/sem candidato
// X, e um ou mais confrontos de 2º turno). O sync antigo escolhia só UM
// cenário "manchete" por pesquisa, quase sempre um de 1º turno, e descartava
// o resto, inclusive os de 2º turno. Isso tornava um filtro real de turno
// impossível (quase não sobrava dado de 2º turno). Agora escolhemos, para cada
// pesquisa, até um cenário manchete de 1º turno E um de 2º turno (quando a
// pesquisa de fato publicou um), gerando até 2 registros por pesquisa, nunca
// inventando um cenário que a pesquisa não publicou.
function pickHeadlineScenarioId(poll, scenarioById, defaultScenarioId, round) {
  const publishedIds = Object.keys(poll.scenarios || {}).filter((id) => scenarioById[id]?.round === round)
  if (publishedIds.length === 0) return null
  if (round === 1 && defaultScenarioId && publishedIds.includes(defaultScenarioId)) return defaultScenarioId
  return publishedIds[0]
}

// Rótulos da fonte vêm crus: "Nome (PARTIDO)" ou, em chapas, "Nome (PARTIDO)
// e Vice (PARTIDO)". Separamos nome e partido e descartamos o vice, mas só
// quando o rótulo é exatamente uma chapa (um único " e " depois do padrão
// "(PARTIDO)"). Rótulos agregados ("A (X), B (Y) e C (Z)" ou "A (X) + B (Y)")
// representam vários candidatos somados e ficam intactos, com partido null.
// Acento/caixa dos nomes reais não são alterados, só espaços normalizados.
const NAME_PARTY_PATTERN = /^(.*?)\s+\(([^)]+)\)/
const TICKET_PATTERN = /^([^,+()]+?)\s+\(([^)]+)\)\s+e\s+[^,+()]+\s+\([^)]+\)$/
const SINGLE_PATTERN = /^([^,+()]+?)\s+\(([^)]+)\)$/

function splitCandidateLabel(raw) {
  const label = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!NAME_PARTY_PATTERN.test(label)) return { candidateName: label, party: null }
  const match = label.match(TICKET_PATTERN) || label.match(SINGLE_PATTERN)
  if (!match) return { candidateName: label, party: null }
  return { candidateName: match[1].trim(), party: match[2].trim() || null }
}

function buildPollEntry(electionEntry, poll, scenarioId, scenarioById, metadataRecords, candidates) {
  const scenarioMeta = scenarioById[scenarioId]
  const scenarioData = poll.scenarios[scenarioId]
  if (!scenarioData || !scenarioData.results) return null

  const results = Object.entries(scenarioData.results)
    .map(([candidateKey, percentage]) => ({
      // A fonte em geral não publica partido por candidato nestes arquivos;
      // só aproveitamos quando vem no próprio rótulo "Nome (PARTIDO)", nunca
      // inventamos um partido.
      ...splitCandidateLabel(candidates[candidateKey]?.name || candidateKey),
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
      // O partido só existe dentro do rótulo cru "Nome (PARTIDO)"; quando não
      // vem ali, fica null (nunca inventamos um partido).
      ...splitCandidateLabel(row.raw_label),
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
    return null
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
  let failed = false
  for (const electionEntry of elections) {
    try {
      const entryPolls = await syncElection(electionEntry)
      polls.push(...entryPolls)
      console.log(`${electionEntry.id}: ${entryPolls.length} pesquisa(s) nos últimos ${DAYS_WINDOW} dias.`)
    } catch (error) {
      console.warn(`Aviso: não foi possível sincronizar ${electionEntry.id} (${error.message}). Pulando esta eleição.`)
      failed = true
    }
  }
  // Falha parcial também conta como falha: gravar só as eleições que vieram
  // apagaria pesquisas reais já publicadas no arquivo anterior.
  return failed ? null : polls
}

// Grava o endpoint só quando a fonte foi de fato sincronizada. Se a busca
// falhou (`polls === null`), mantém o arquivo anterior intacto em vez de
// sobrescrevê-lo com uma lista vazia, e avisa no log.
function writeEndpoint(file, polls, sourceHome, label) {
  if (polls === null) {
    if (existsSync(file)) {
      console.warn(`Aviso: ${label} não sincronizado; mantendo o arquivo anterior ${file}.`)
    } else {
      console.warn(`Aviso: ${label} não sincronizado e não há arquivo anterior em ${file}; nada gravado.`)
    }
    return false
  }
  polls.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0))
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        generatedAt: now.toISOString(),
        source: polls.length > 0 ? sourceHome : null,
        polls,
      },
      null,
      2,
    )}\n`,
  )
  return true
}

async function main() {
  const [presidentePolls, governadorPolls] = await Promise.all([
    syncPresidentePolls(),
    syncGovernadorPolls().catch((error) => {
      console.warn(`Aviso: falha ao buscar pesquisas de Governador em ${GOV_DATA_URL} (${error.message}). Pulando Governador.`)
      return null
    }),
  ])

  if (governadorPolls) {
    console.log(`governador (puxa-ficha): ${governadorPolls.length} registro(s) nos últimos ${DAYS_WINDOW} dias.`)
  }

  const wrotePresidente = writeEndpoint(presidenteOutputFile, presidentePolls, REPO_HOME, 'Presidente')
  const wroteGovernador = writeEndpoint(governadorOutputFile, governadorPolls, GOV_REPO_HOME, 'Governador')

  if (!wrotePresidente && !wroteGovernador) {
    console.error('Nenhuma das fontes de pesquisa pôde ser sincronizada. Arquivos anteriores mantidos (sem dados inventados).')
    process.exitCode = 1
    return
  }

  console.log(
    `Pesquisas: ${wrotePresidente ? presidentePolls.length : 'mantido'} Presidente em public/data/polls-presidente-nacional.json, ` +
      `${wroteGovernador ? governadorPolls.length : 'mantido'} Governador em public/data/polls-governador-estados.json`,
  )
}

await main()
