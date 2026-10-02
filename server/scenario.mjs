// Modulo deterministico de "Cenarios (IA)". NENHUM numero de probabilidade
// aqui vem de um modelo de linguagem: tudo e calculado por codigo comum a
// partir dos dados reais de pesquisa ja publicados em public/data/polls-*.json.
// A funcao computeScenario() e pura (le os JSONs via server/data.mjs, que so
// faz readFile + JSON.parse) e pode ser chamada isoladamente, inclusive por
// `node -e`, sem subir o servidor HTTP.
//
// Metodologia (resumo, ver tambem o campo `methodologyNote` da resposta):
// 1. So a onda/pesquisa mais recente de uma unica fonte e usada (sem misturar
//    pesquisas/institutos diferentes numa "pesquisa composta" ficticia).
// 2. Cada candidato tem sua parcela reportada (p) tratada como a media de uma
//    distribuicao normal; o desvio padrao (sigma) vem da margem de erro
//    declarada pela fonte (convencao: margem = meia-largura de um IC de 95%,
//    logo sigma = margem/1.96) ou, na ausencia de margem declarada mas com
//    tamanho de amostra conhecido, do pior caso teorico para uma proporcao
//    (formula de Wilson simplificada p=0.5: margem = 1.96*sqrt(0.25/n)).
// 3. Rodamos 20000 simulacoes: em cada uma, sorteamos uma parcela por
//    candidato, zeramos sorteios negativos e renormalizamos para que as
//    parcelas dos candidatos reais (excluindo indecisos/brancos/nulos, que
//    nao estao na cedula) somem 100%. Isso assume que os erros de cada
//    candidato sao independentes entre si, e que indecisos se distribuem
//    proporcionalmente entre os candidatos reais -- ambas simplificacoes
//    reais, declaradas explicitamente no `methodologyNote`.
// 4. Vence no 1o turno quem ultrapassa 50% das simulacoes; senao vai a 2o
//    turno (Presidente/Governador, unicos cargos com 2o turno no Brasil).
//
// Isto NAO e um modelo de projecao eleitoral com fundamentos socioeconomicos,
// demograficos ou historicos -- e uma leitura estatistica simples de uma
// unica pesquisa, com as limitacoes que isso implica.

import { loadPresidenteNacional, loadPresidenteEstados, loadGovernadorEstados } from './data.mjs'

export const SIMULATIONS = 20000
const Z95 = 1.96

/** Mesma heuristica de src/components/ui/pesquisas-tracker.tsx
 * (isPseudoCandidateRow): linhas de "indecisos/brancos/nulos/nao sabe" nao
 * sao candidatos reais e nao devem entrar na simulacao de vitoria/maioria.
 * Duplicada aqui de proposito (arquivo .tsx nao e importavel por este modulo
 * Node puro, e a instrucao do projeto pede para duplicar em vez de refatorar
 * aquele arquivo). */
function isPseudoCandidateRow(candidateName) {
  return /indecis|branco|\bnulo|não sabe|nao sabe|não soube|nao soube|não opin|nao opin|não respond|nao respond|nenhum candidato|não vai votar|nao vai votar|outras respostas|^outros\b/i.test(
    candidateName,
  )
}

function isSpontaneousScenario(label) {
  return !!label && /espont/i.test(label)
}

function firstUrl(value) {
  if (!value) return null
  return value.split(';')[0].trim()
}

/** Extrai margem de erro (em pontos percentuais) e tamanho de amostra de um
 * texto livre como "804; ±3 pp" ou "1,218; ±2 pp" ou so "±3 pp" ou so "900".
 * Nao inventa numero algum: se o padrao nao aparece no texto, retorna null
 * para aquele campo. */
function parseFreeTextSample(raw) {
  if (raw == null) return { n: null, marginPp: null }
  if (typeof raw === 'number') return { n: Number.isFinite(raw) ? raw : null, marginPp: null }
  const marginMatch = raw.match(/±\s*(\d+(?:[.,]\d+)?)\s*p/i)
  const marginPp = marginMatch ? parseFloat(marginMatch[1].replace(',', '.')) : null
  const nRaw = raw.split(';')[0].trim()
  const nDigits = nRaw.replace(/[^\d.,]/g, '')
  let n = null
  if (nDigits) {
    const normalized = nDigits.replace(/,/g, '')
    const parsed = Number(normalized)
    if (Number.isFinite(parsed) && parsed > 0) n = parsed
  }
  return { n, marginPp }
}

/** Fontes estruturadas (polls-presidente-nacional.json, polls-governador-estados.json)
 * ja trazem marginOfError/sampleSize como numeros. Fonte em texto livre
 * (polls-presidente-estados.json, campo `sample`) precisa de parseFreeTextSample. */
function resolvePollMarginAndN({ marginOfError, sampleSize, sampleText }) {
  if (sampleText !== undefined) return parseFreeTextSample(sampleText)
  const marginPp = typeof marginOfError === 'number' && Number.isFinite(marginOfError) ? marginOfError : null
  const n = typeof sampleSize === 'number' && Number.isFinite(sampleSize) && sampleSize > 0 ? sampleSize : null
  return { n, marginPp }
}

function sigmaFromMargin(marginPp) {
  return marginPp / 100 / Z95
}

function sigmaFromSampleSize(n) {
  return Math.sqrt(0.25 / n)
}

function estimatedMarginPpFromSampleSize(n) {
  return Z95 * Math.sqrt(0.25 / n) * 100
}

/** Box-Muller padrao (media 0, desvio 1). */
function randStandardNormal() {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function pickMostRecentPresidenteNacional(file, { round }) {
  const waves = file.polls.filter((p) => p.office === 'Presidente' && p.uf === 'BR' && p.round === round)
  if (!waves.length) return null
  waves.sort((a, b) => {
    if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1
    const aEnd = a.fieldDates?.end ?? ''
    const bEnd = b.fieldDates?.end ?? ''
    if (aEnd !== bEnd) return aEnd < bEnd ? 1 : -1
    return a.institute.localeCompare(b.institute, 'pt-BR')
  })
  return waves[0]
}

function pickMostRecentGovernador(file, uf, { round }) {
  const waves = file.polls.filter(
    (p) => p.office === 'Governador' && p.uf === uf && p.round === round && !isSpontaneousScenario(p.scenarioLabel),
  )
  if (!waves.length) return null
  waves.sort((a, b) => {
    if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1
    const aEnd = a.fieldDates?.end ?? ''
    const bEnd = b.fieldDates?.end ?? ''
    if (aEnd !== bEnd) return aEnd < bEnd ? 1 : -1
    if (a.results.length !== b.results.length) return b.results.length - a.results.length
    return a.id.localeCompare(b.id, 'pt-BR')
  })
  return waves[0]
}

/** polls-presidente-estados.json nao tem campo de data unico e comparavel:
 * cada UF guarda `waves` (rodadas) numa lista. Inspecao manual dos 27
 * estados confirmou que, sempre que ha mais de uma onda, elas aparecem em
 * ordem cronologica crescente (ex.: "Aug round" antes de "Late-Sep round"/
 * "Late-Sep (apenas lideres divulgados)"), confirmado pelos proprios
 * intervalos de campo (`fieldwork`) dentro de cada UF. Por isso "ultimo
 * elemento do array" e usado como proxy confiavel de "onda mais recente"
 * para esta fonte especifica -- nao existe campo de data estruturado para
 * ordenar de outra forma sem arriscar comparar texto livre incomparavel
 * ("Quaest/Globo, 2nd half of Sep 2026" vs "23-26 Aug 2026"). */
function pickMostRecentPresidenteEstado(file, uf) {
  const state = file.states.find((s) => s.uf === uf)
  if (!state || !state.waves.length) return null
  return { state, wave: state.waves[state.waves.length - 1] }
}

function buildCandidateList(results) {
  return results
    .filter((r) => !isPseudoCandidateRow(r.candidateName))
    .map((r) => ({ candidateName: r.candidateName, party: r.party ?? null, percentage: r.percentage }))
    .filter((r) => typeof r.percentage === 'number' && Number.isFinite(r.percentage))
}

function runMonteCarlo(candidates, sigma) {
  const n = candidates.length
  const leadCounts = new Array(n).fill(0)
  let outrightCount = 0
  for (let draw = 0; draw < SIMULATIONS; draw += 1) {
    let sum = 0
    const shares = new Array(n)
    for (let i = 0; i < n; i += 1) {
      const mean = candidates[i].percentage / 100
      let share = mean + sigma * randStandardNormal()
      if (share < 0) share = 0
      shares[i] = share
      sum += share
    }
    let leaderIdx = 0
    let leaderShare = -1
    for (let i = 0; i < n; i += 1) {
      const normalized = sum > 0 ? shares[i] / sum : 1 / n
      if (normalized > leaderShare) {
        leaderShare = normalized
        leaderIdx = i
      }
    }
    leadCounts[leaderIdx] += 1
    if (leaderShare > 0.5) outrightCount += 1
  }
  return {
    leadProbability: leadCounts.map((count) => count / SIMULATIONS),
    outrightWinProbability: outrightCount / SIMULATIONS,
    runoffProbability: 1 - outrightCount / SIMULATIONS,
  }
}

function methodologyNote({ marginPp, marginSource, n }) {
  const marginText =
    marginSource === 'estimated_from_sample_size'
      ? `margem estimada em ±${marginPp.toFixed(1)} p.p. a partir do tamanho de amostra (${n} entrevistas), pois a fonte não declarou margem de erro`
      : `margem de erro declarada pela fonte: ±${marginPp.toFixed(1)} p.p.`
  return (
    `Simulação de Monte Carlo com ${SIMULATIONS.toLocaleString('pt-BR')} sorteios, a partir da pesquisa mais recente ` +
    `disponível para este recorte (uma única onda, sem mistura de institutos). Cada candidato tem sua parcela ` +
    `reportada tratada como média de uma distribuição normal; ${marginText}, convertida em desvio padrão assumindo ` +
    `que a margem publicada é a metade de um intervalo de confiança de 95% (sigma = margem / 1.96). Em cada sorteio, ` +
    `as parcelas negativas são zeradas e o conjunto de candidatos reais (excluindo indecisos/brancos/nulos, que não ` +
    `estão na cédula) é renormalizado para somar 100%, assumindo que os erros de cada candidato são independentes ` +
    `entre si e que os indecisos se distribuiriam proporcionalmente entre os candidatos reais, duas simplificações ` +
    `reais. Isto é uma estimativa estatística simples a partir de uma única pesquisa, não é um modelo de projeção ` +
    `eleitoral com fundamentos socioeconômicos, demográficos ou históricos.`
  )
}

function notSimulatableNote() {
  return (
    `A fonte não informou margem de erro nem tamanho de amostra para esta pesquisa, não é possível estimar uma ` +
    `distribuição de probabilidade sem inventar um número. Os percentuais abaixo são exatamente os publicados pela ` +
    `fonte, sem simulação.`
  )
}

function buildNotSimulatable({ office, uf, candidates, sourcePoll, round }) {
  return {
    office,
    uf,
    round,
    simulatable: false,
    reason:
      'A fonte não informou margem de erro nem tamanho de amostra para esta pesquisa, não é possível estimar uma distribuição.',
    candidates: candidates.map((c) => ({ candidateName: c.candidateName, party: c.party, percentage: c.percentage })),
    leadProbability: null,
    outrightWinProbability: null,
    runoffProbability: null,
    completenessWarning: null,
    methodologyNote: notSimulatableNote(),
    sourcePoll,
  }
}

/**
 * Calcula o cenario estatistico (probabilidades de lideranca / vitoria em
 * 1o turno / 2o turno) para um recorte office+uf, a partir da onda de
 * pesquisa mais recente disponivel nos arquivos public/data/polls-*.json.
 *
 * @param {{ office: 'Presidente' | 'Governador', uf?: string | null, round?: 1 | 2 }} params
 * @returns {Promise<object>} objeto serializavel em JSON, nunca lanca para
 *   "dado faltando" (isso vira simulatable:false) -- so lanca para parametros
 *   invalidos (cargo nao suportado, UF inexistente, cargo+UF sem pesquisa).
 */
export async function computeScenario({ office, uf = null, round = 1 }) {
  if (office !== 'Presidente' && office !== 'Governador') {
    throw new Error(
      `Cargo "${office}" não suportado em Cenários (IA). Apenas Presidente e Governador têm o corte "vitória/2º turno" de maioria absoluta; Senado é pluralidade simples e fica de fora de propósito.`,
    )
  }
  if (round !== 1) {
    throw new Error('Cenários (IA) só simula o 1º turno (onde a regra de maioria absoluta de 50%+1 se aplica).')
  }
  const normalizedUf = office === 'Presidente' && (!uf || uf === 'BR') ? 'BR' : uf
  if (office === 'Governador' && (!normalizedUf || normalizedUf === 'BR')) {
    throw new Error('Não existe "Governador do Brasil": informe uma UF para o cargo de Governador.')
  }

  let wave
  let results
  let sourcePoll
  let completenessWarning = null

  if (office === 'Presidente' && normalizedUf === 'BR') {
    const file = await loadPresidenteNacional()
    wave = pickMostRecentPresidenteNacional(file, { round })
    if (!wave) throw new Error('Nenhuma pesquisa nacional de Presidente (1º turno) encontrada na fonte local.')
    results = wave.results
    const { n, marginPp } = resolvePollMarginAndN({ marginOfError: wave.marginOfError, sampleSize: wave.sampleSize })
    sourcePoll = {
      pollster: wave.institute,
      commissioner: wave.commissioner,
      fieldwork: wave.fieldDates ? `${wave.fieldDates.start} a ${wave.fieldDates.end}` : null,
      publishedAt: wave.publishedAt,
      scenarioLabel: wave.scenarioLabel,
      sampleSize: n,
      marginOfErrorPp: marginPp,
      sourceUrl: firstUrl(wave.sourceUrl),
    }
    return finishScenario({ office, uf: 'BR', round, results, n, marginPp, sourcePoll, completenessWarning })
  }

  if (office === 'Presidente' && normalizedUf !== 'BR') {
    const file = await loadPresidenteEstados()
    const picked = pickMostRecentPresidenteEstado(file, normalizedUf)
    if (!picked) throw new Error(`Nenhuma pesquisa de Presidente por estado encontrada para a UF "${normalizedUf}".`)
    const { state, wave: stateWave } = picked
    results = stateWave.results
    const { n, marginPp } = resolvePollMarginAndN({ sampleText: stateWave.sample })
    if (stateWave.completeness === 'Leaders only') {
      completenessWarning =
        'Esta pesquisa divulgou só os líderes (cenário "Leaders only" da fonte); candidatos menores já ficam de fora da base reportada, então a probabilidade de vitória/2º turno é menos representativa do universo completo de candidatos.'
    }
    sourcePoll = {
      pollster: stateWave.pollster,
      state: state.state,
      fieldwork: stateWave.fieldwork,
      publishedAt: null,
      vintage: stateWave.vintage,
      completeness: stateWave.completeness,
      sampleSize: n,
      marginOfErrorPp: marginPp,
      sourceUrl: firstUrl(stateWave.sourceUrl),
    }
    return finishScenario({ office, uf: normalizedUf, round, results, n, marginPp, sourcePoll, completenessWarning })
  }

  // office === 'Governador'
  const file = await loadGovernadorEstados()
  wave = pickMostRecentGovernador(file, normalizedUf, { round })
  if (!wave) throw new Error(`Nenhuma pesquisa de Governador encontrada para a UF "${normalizedUf}".`)
  results = wave.results
  const { n, marginPp } = resolvePollMarginAndN({ marginOfError: wave.marginOfError, sampleSize: wave.sampleSize })
  sourcePoll = {
    pollster: wave.institute,
    commissioner: wave.commissioner,
    fieldwork: wave.fieldDates ? `${wave.fieldDates.start} a ${wave.fieldDates.end}` : null,
    publishedAt: wave.publishedAt,
    scenarioLabel: wave.scenarioLabel,
    sampleSize: n,
    marginOfErrorPp: marginPp,
    sourceUrl: firstUrl(wave.sourceUrl),
  }
  return finishScenario({ office, uf: normalizedUf, round, results, n, marginPp, sourcePoll, completenessWarning })
}

function finishScenario({ office, uf, round, results, n, marginPp, sourcePoll, completenessWarning }) {
  const candidates = buildCandidateList(results)

  if (!candidates.length) {
    throw new Error('Nenhum candidato real (não-pseudo) encontrado nos resultados desta pesquisa.')
  }

  if (candidates.length <= 2 && !completenessWarning) {
    completenessWarning =
      'Esta pesquisa reporta só 2 candidatos reais; se houver mais nomes na disputa que não entraram nesta base, a probabilidade de vitória/2º turno é menos representativa do universo completo de candidatos.'
  }

  let marginSource = null
  let effectiveMarginPp = marginPp

  if (marginPp != null) {
    marginSource = 'reported'
  } else if (n != null) {
    marginSource = 'estimated_from_sample_size'
    effectiveMarginPp = estimatedMarginPpFromSampleSize(n)
  }

  if (marginSource == null) {
    return buildNotSimulatable({ office, uf, round, candidates, sourcePoll })
  }

  const sigma = sigmaFromMargin(effectiveMarginPp)
  const { leadProbability, outrightWinProbability, runoffProbability } = runMonteCarlo(candidates, sigma)

  return {
    office,
    uf,
    round,
    simulatable: true,
    reason: null,
    simulations: SIMULATIONS,
    candidates: candidates.map((c, i) => ({
      candidateName: c.candidateName,
      party: c.party,
      percentage: c.percentage,
      marginSource,
      leadProbability: leadProbability[i],
    })),
    leadProbability: Object.fromEntries(candidates.map((c, i) => [c.candidateName, leadProbability[i]])),
    outrightWinProbability,
    runoffProbability,
    completenessWarning,
    methodologyNote: methodologyNote({ marginPp: effectiveMarginPp, marginSource, n }),
    sourcePoll: { ...sourcePoll, marginOfErrorPp: effectiveMarginPp, marginSource },
  }
}
