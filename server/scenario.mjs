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
//    distribuicao normal; o desvio padrao e proprio de cada candidato,
//    sqrt(p(1-p)/n_ef) x inflacao, onde n_ef sai da margem de erro declarada
//    pela fonte (convencao: margem = meia-largura de um IC de 95% para p=0.5,
//    logo n_ef = 0.25*(1.96/margem)^2) ou, na ausencia de margem declarada, do
//    tamanho de amostra informado. Candidatos com p<=0 ficam fora do sorteio.
//    O RNG e semeado por cargo+UF+turno, entao os numeros sao estaveis.
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

import { loadPresidenteNacional, loadPresidenteEstados, loadGovernadorEstados, loadPartyIdeology } from './data.mjs'

export const SIMULATIONS = 20000
const Z95 = 1.96

// Usar só a margem amostral declarada pela pesquisa como fonte de incerteza
// sub-estima MUITO o erro real: ela não cobre viés de método, recusa
// diferencial, indecisos que mudam de ideia etc. Shirani-Mehr, Rothschild,
// Goel & Gelman ("Disentangling Bias and Variance in Election Polls", JASA
// 2018) mediram, em milhares de pesquisas eleitorais reais nos EUA, que o
// erro total médio é cerca de 2x a margem de erro amostral declarada. Esse
// fator é aplicado aqui pra não fingir uma certeza (0%/100%) que a margem
// amostral sozinha não sustenta -- ainda uma simplificação (não é uma
// medição brasileira específica), mas documentada e citável, não inventada.
const TOTAL_ERROR_INFLATION = 2

/** Mesma heuristica de src/components/ui/pesquisas-tracker.tsx
 * (isPseudoCandidateRow): linhas de "indecisos/brancos/nulos/nao sabe" nao
 * sao candidatos reais e nao devem entrar na simulacao de vitoria/maioria.
 * Duplicada aqui de proposito (arquivo .tsx nao e importavel por este modulo
 * Node puro, e a instrucao do projeto pede para duplicar em vez de refatorar
 * aquele arquivo). */
function isPseudoCandidateRow(candidateName) {
  return /indecis|branco|\bnulo|não sabe|nao sabe|não soube|nao soube|não opin|nao opin|não respond|nao respond|nenhum candidato|não vai votar|nao vai votar|outras respostas|^outros\b|ns ?\/ ?nr|n[ãa]o sei|^nenhum|demais (candidatos|op[çc][õo]es)|n[ãa]o decidi|n[ãa]o v[ãa]o escolher|\+/i.test(
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

/** Tamanho de amostra "efetivo" implicito na margem declarada: inverte a
 * formula do pior caso (p=0.5) margem = 1.96*sqrt(0.25/n). Quando a fonte
 * declara margem, ela ja embute efeito de desenho/ponderacao, por isso tem
 * prioridade sobre o n bruto. */
function effectiveNFromMargin(marginPp) {
  const m = marginPp / 100
  return 0.25 * (Z95 / m) ** 2
}

function estimatedMarginPpFromSampleSize(n) {
  return Z95 * Math.sqrt(0.25 / n) * 100
}

/** Desvio padrao por candidato: sqrt(p(1-p)/n_eff), inflado pelo fator de
 * erro total. Para p=0.5 coincide com margem/1.96 (convencao antiga); para
 * candidatos pequenos o desvio encolhe, evitando que um nome com 0,1% ganhe
 * parcela fantasma so porque herdou o sigma de quem tem 45%. */
function candidateSigma(p, nEff) {
  return Math.sqrt((p * (1 - p)) / nEff) * TOTAL_ERROR_INFLATION
}

/** Hash FNV-1a 32 bits de uma string, usado como semente do RNG. */
function hashSeed(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: RNG pequeno e deterministico. A mesma semente
 * (cargo+UF+turno) gera sempre os mesmos sorteios, entao /api/scenario, os
 * resumos por estado e o contexto do chat mostram exatamente os mesmos
 * numeros entre chamadas e reinicializacoes. Retorna valores em (0, 1). */
function createRng(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    return r === 0 ? 1 / 4294967296 : r
  }
}

/** Box-Muller padrao (media 0, desvio 1) sobre o RNG semeado. */
function randStandardNormal(rng) {
  const u = rng()
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Arredonda probabilidades para no maximo 3 casas decimais, sempre do
 * mesmo jeito em todas as saidas (API e contexto do chat). */
function roundProb(value) {
  return Math.round(value * 1000) / 1000
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
  const latest = state.waves[state.waves.length - 1]
  if (waveHasSampleOrMargin(latest)) return { state, wave: latest, skippedWave: null }
  // A onda mais recente nao trouxe amostra nem margem (ex.: "Late-Sep (apenas
  // lideres divulgados)"): sem isso nao da pra simular. Cai para a onda mais
  // recente que tenha amostra ou margem, deixando explicito qual foi pulada.
  for (let i = state.waves.length - 2; i >= 0; i -= 1) {
    if (waveHasSampleOrMargin(state.waves[i])) return { state, wave: state.waves[i], skippedWave: latest }
  }
  return { state, wave: latest, skippedWave: null }
}

function waveHasSampleOrMargin(wave) {
  const { n, marginPp } = parseFreeTextSample(wave?.sample ?? null)
  return n != null || marginPp != null
}

/** Monta um lookup partido -> entrada de public/data/party-ideology.json.
 * Arquivo e fonte academica unica (ver `source` do proprio JSON), nunca
 * opiniao deste site; so repassamos o que ja esta la, sem inferir nada para
 * partidos ausentes. */
function buildIdeologyLookup(ideologyFile) {
  const map = new Map()
  for (const entry of ideologyFile.parties) {
    map.set(entry.party, entry)
  }
  return map
}

/** Resolve a classificacao ideologica de um partido a partir do lookup.
 * Retorna sempre os dois campos, nunca omite: `ideologyAvailable: false`
 * sinaliza explicitamente "sem dado citavel", para o LLM nao confundir com
 * "este partido nao tem ideologia". Partido ausente do arquivo-fonte, sem
 * partido informado, ou `available: false` na fonte: mesmo resultado. */
function resolveIdeology(party, ideologyLookup) {
  if (!party) return { ideology: null, ideologyAvailable: false }
  const entry = ideologyLookup.get(party)
  if (!entry || entry.available !== true) {
    return { ideology: null, ideologyAvailable: false }
  }
  return { ideology: entry.classification, ideologyAvailable: true }
}

/** Citacao da fonte academica unica de classificacao ideologica, para ser
 * incluida uma unica vez no topo da resposta (nao repetida por candidato). */
function ideologySourceCitation(ideologyFile) {
  const { publisher, title, year, url } = ideologyFile.source
  return { publisher, title, year, url }
}

function buildCandidateList(results, ideologyLookup) {
  return results
    .filter((r) => !isPseudoCandidateRow(r.candidateName))
    .map((r) => ({
      candidateName: r.candidateName,
      party: r.party ?? null,
      percentage: r.percentage,
      ...resolveIdeology(r.party ?? null, ideologyLookup),
    }))
    .filter((r) => typeof r.percentage === 'number' && Number.isFinite(r.percentage))
}

/** Monte Carlo com sigma proprio por candidato. Candidatos com p<=0 nao
 * entram no sorteio (seguem listados, com probabilidade 0): sorteá-los com
 * truncamento em zero so criaria parcela fantasma e distorceria a
 * renormalizacao dos demais. */
function runMonteCarlo(candidates, nEff, seed) {
  const n = candidates.length
  const rng = createRng(seed)
  const active = []
  for (let i = 0; i < n; i += 1) {
    const p = candidates[i].percentage / 100
    if (p > 0) active.push({ idx: i, mean: p, sigma: candidateSigma(Math.min(p, 1), nEff) })
  }
  const leadCounts = new Array(n).fill(0)
  const outrightByCandidate = new Array(n).fill(0)
  let outrightCount = 0
  if (!active.length) {
    return {
      leadProbability: leadCounts,
      candidateOutrightProbability: outrightByCandidate,
      outrightWinProbability: 0,
      runoffProbability: 1,
    }
  }
  const shares = new Array(active.length)
  for (let draw = 0; draw < SIMULATIONS; draw += 1) {
    let sum = 0
    for (let k = 0; k < active.length; k += 1) {
      let share = active[k].mean + active[k].sigma * randStandardNormal(rng)
      if (share < 0) share = 0
      shares[k] = share
      sum += share
    }
    let leaderK = 0
    let leaderShare = -1
    for (let k = 0; k < active.length; k += 1) {
      const normalized = sum > 0 ? shares[k] / sum : 1 / active.length
      if (normalized > leaderShare) {
        leaderShare = normalized
        leaderK = k
      }
    }
    const leaderIdx = active[leaderK].idx
    leadCounts[leaderIdx] += 1
    if (leaderShare > 0.5) {
      outrightCount += 1
      outrightByCandidate[leaderIdx] += 1
    }
  }
  const outright = roundProb(outrightCount / SIMULATIONS)
  return {
    leadProbability: leadCounts.map((count) => roundProb(count / SIMULATIONS)),
    candidateOutrightProbability: outrightByCandidate.map((count) => roundProb(count / SIMULATIONS)),
    outrightWinProbability: outright,
    runoffProbability: roundProb(1 - outright),
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
    `reportada tratada como média de uma distribuição normal; ${marginText}, convertida em tamanho de amostra ` +
    `efetivo assumindo que a margem publicada é a metade de um intervalo de confiança de 95% para p=50% ` +
    `(n_ef = 0,25 x (1,96 / margem)²). O desvio padrão é próprio de cada candidato, sqrt(p(1-p)/n_ef), e é ` +
    `multiplicado por ${TOTAL_ERROR_INFLATION}x antes de simular: pesquisas de opinião têm, em média, o dobro de erro ` +
    `total (viés de método, recusa, indecisos que mudam de ideia) em relação à margem puramente amostral declarada ` +
    `(Shirani-Mehr, Rothschild, Goel & Gelman, "Disentangling Bias and Variance in Election Polls", JASA 2018); sem ` +
    `esse ajuste, uma única pesquisa com vantagem grande mostraria 0%/100% de forma artificialmente confiante. Em ` +
    `cada sorteio, as parcelas negativas são zeradas (candidatos com 0% reportado ficam fora do sorteio, com ` +
    `probabilidade 0) e o conjunto de candidatos reais (excluindo indecisos/brancos/ ` +
    `nulos, que não estão na cédula) é renormalizado para somar 100%, assumindo que os erros de cada candidato são ` +
    `independentes entre si e que os indecisos se distribuiriam proporcionalmente entre os candidatos reais, duas ` +
    `simplificações reais. Isto é uma estimativa estatística simples a partir de uma única pesquisa, não é um ` +
    `modelo de projeção eleitoral com fundamentos socioeconômicos, demográficos ou históricos.`
  )
}

function notSimulatableNote() {
  return (
    `A fonte não informou margem de erro nem tamanho de amostra para esta pesquisa, não é possível estimar uma ` +
    `distribuição de probabilidade sem inventar um número. Os percentuais abaixo são exatamente os publicados pela ` +
    `fonte, sem simulação.`
  )
}

function buildNotSimulatable({ office, uf, candidates, sourcePoll, round, ideologyFile, reportedPercentageSum, unallocatedPercentage, completenessWarning }) {
  return {
    office,
    uf,
    round,
    simulatable: false,
    reason:
      'A fonte não informou margem de erro nem tamanho de amostra para esta pesquisa, não é possível estimar uma distribuição.',
    candidates: candidates.map((c) => ({
      candidateName: c.candidateName,
      party: c.party,
      percentage: c.percentage,
      ideology: c.ideology,
      ideologyAvailable: c.ideologyAvailable,
    })),
    leadProbability: null,
    outrightWinProbability: null,
    runoffProbability: null,
    reportedPercentageSum,
    unallocatedPercentage,
    completenessWarning: completenessWarning ?? null,
    methodologyNote: notSimulatableNote(),
    sourcePoll,
    ideologySource: ideologySourceCitation(ideologyFile),
  }
}

/**
 * Resumo por estado da corrida presidencial (as 27 UFs de
 * polls-presidente-estados.json), usado só para abrir o escopo do chat de
 * Cenários (IA) pra perguntas tipo "em quais estados X lidera" -- sem isso,
 * cada pergunta só enxerga o recorte (BR ou 1 UF) selecionado na tela. Cada
 * entrada roda o mesmo computeScenario de sempre (Monte Carlo real, mesmo
 * dado publico), nunca um numero inventado; estados sem pesquisa citavel
 * suficiente (simulatable:false) ainda aparecem, com os percentuais crus.
 */
export function buildPresidenteEstadosSummary() {
  return memoSummary('Presidente', async () => {
    const file = await loadPresidenteEstados()
    return summarizeUfs('Presidente', file.states.map((s) => s.uf), (uf) => file.states.find((s) => s.uf === uf)?.state ?? uf)
  })
}

/**
 * Mesma ideia de buildPresidenteEstadosSummary(), mas para a corrida de
 * Governador: um resumo com as 27 UFs, usado para abrir o escopo do chat de
 * Cenários (IA) pra perguntas sobre Governador de um estado diferente do
 * recorte atualmente selecionado na tela (ex.: perguntar sobre Governador de
 * SP com a tela aberta em Presidente/Nacional). polls-governador-estados.json
 * não tem uma lista `states` de topo (só o array `polls`), por isso as UFs
 * são deduzidas a partir dos próprios polls.
 */
export function buildGovernadorEstadosSummary() {
  return memoSummary('Governador', async () => {
    const file = await loadGovernadorEstados()
    return summarizeUfs('Governador', [...new Set(file.polls.map((p) => p.uf))].sort(), null)
  })
}

const summaryMemo = new Map()

/** Memo em processo dos resumos por estado (mesma logica do memo de
 * computeScenario: dados estaticos + RNG semeado = resultado imutavel). */
function memoSummary(key, build) {
  if (summaryMemo.has(key)) return summaryMemo.get(key)
  const promise = build()
  summaryMemo.set(key, promise)
  promise.catch(() => summaryMemo.delete(key))
  return promise
}

async function summarizeUfs(office, ufs, stateName) {
  const summaries = []
  for (const uf of ufs) {
    try {
      const scenario = await computeScenario({ office, uf, round: 1 })
      const leader = scenario.simulatable
        ? [...scenario.candidates].sort((a, b) => b.leadProbability - a.leadProbability || b.percentage - a.percentage)[0]
        : [...scenario.candidates].sort((a, b) => b.percentage - a.percentage)[0]
      summaries.push({
        uf,
        ...(stateName ? { state: stateName(uf) } : {}),
        simulatable: scenario.simulatable,
        leadingCandidate: leader?.candidateName ?? null,
        leadingCandidateParty: leader?.party ?? null,
        leadingCandidatePercentage: leader?.percentage ?? null,
        leadingCandidateLeadProbability: scenario.simulatable ? leader?.leadProbability ?? null : null,
        // Chance de o LIDER vencer no 1o turno (por candidato).
        leadingCandidateWinsOutrightProbability: scenario.simulatable ? leader?.winsOutrightProbability ?? null : null,
        // Chance de QUALQUER candidato vencer no 1o turno (nivel da disputa).
        anyCandidateOutrightWinProbability: scenario.simulatable ? scenario.outrightWinProbability : null,
        runoffProbability: scenario.simulatable ? scenario.runoffProbability : null,
        pollWave: scenario.sourcePoll?.vintage ?? scenario.sourcePoll?.fieldwork ?? null,
      })
    } catch {
      // UF sem pesquisa utilizavel: omitida do resumo, nunca preenchida com
      // dado inventado.
    }
  }
  return summaries
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
// Memo em processo: os JSONs ja ficam em cache (server/data.mjs) e o RNG e
// semeado, entao o resultado de um recorte nunca muda durante a vida do
// processo. Guarda a Promise (chamadas concorrentes reaproveitam o mesmo
// calculo); erro sai do memo para nao "grudar".
const scenarioMemo = new Map()

export function computeScenario({ office, uf = null, round = 1 }) {
  const key = `${office}|${uf ?? ''}|${round}`
  if (scenarioMemo.has(key)) return scenarioMemo.get(key)
  const promise = computeScenarioUncached({ office, uf, round })
  scenarioMemo.set(key, promise)
  promise.catch(() => scenarioMemo.delete(key))
  return promise
}

async function computeScenarioUncached({ office, uf = null, round = 1 }) {
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
  const ideologyFile = await loadPartyIdeology()
  const ideologyLookup = buildIdeologyLookup(ideologyFile)

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
    return finishScenario({ office, uf: 'BR', round, results, n, marginPp, sourcePoll, completenessWarning, ideologyFile, ideologyLookup })
  }

  if (office === 'Presidente' && normalizedUf !== 'BR') {
    const file = await loadPresidenteEstados()
    const picked = pickMostRecentPresidenteEstado(file, normalizedUf)
    if (!picked) throw new Error(`Nenhuma pesquisa de Presidente por estado encontrada para a UF "${normalizedUf}".`)
    const { state, wave: stateWave, skippedWave } = picked
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
      waveNote: skippedWave
        ? `A onda mais recente ("${skippedWave.vintage}", ${skippedWave.fieldwork ?? 'sem data de campo'}) não informou amostra nem margem de erro; usada a onda completa mais recente com esses dados ("${stateWave.vintage}", campo ${stateWave.fieldwork ?? 'sem data'}).`
        : null,
      sampleSize: n,
      marginOfErrorPp: marginPp,
      sourceUrl: firstUrl(stateWave.sourceUrl),
    }
    return finishScenario({ office, uf: normalizedUf, round, results, n, marginPp, sourcePoll, completenessWarning, ideologyFile, ideologyLookup })
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
  return finishScenario({ office, uf: normalizedUf, round, results, n, marginPp, sourcePoll, completenessWarning, ideologyFile, ideologyLookup })
}

function finishScenario({ office, uf, round, results, n, marginPp, sourcePoll, completenessWarning, ideologyFile, ideologyLookup }) {
  const candidates = buildCandidateList(results, ideologyLookup)

  if (!candidates.length) {
    throw new Error('Nenhum candidato real (não-pseudo) encontrado nos resultados desta pesquisa.')
  }

  const reportedPercentageSum = Math.round(candidates.reduce((sum, c) => sum + c.percentage, 0) * 10) / 10
  const unallocatedPercentage = Math.max(0, Math.round((100 - reportedPercentageSum) * 10) / 10)

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
    return buildNotSimulatable({ office, uf, round, candidates, sourcePoll, ideologyFile, reportedPercentageSum, unallocatedPercentage, completenessWarning })
  }

  const nEff = marginSource === 'reported' ? effectiveNFromMargin(effectiveMarginPp) : n
  const { leadProbability, candidateOutrightProbability, outrightWinProbability, runoffProbability } = runMonteCarlo(
    candidates,
    nEff,
    hashSeed(`${office}|${uf}|${round}`),
  )

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
      // Chance de ESTE candidato vencer no 1o turno (>50% dos validos).
      winsOutrightProbability: candidateOutrightProbability[i],
      ideology: c.ideology,
      ideologyAvailable: c.ideologyAvailable,
    })),
    leadProbability: Object.fromEntries(candidates.map((c, i) => [c.candidateName, leadProbability[i]])),
    // Nivel da DISPUTA: chance de QUALQUER candidato vencer no 1o turno (mantido
    // com este nome por compatibilidade com src/components/ui/cenarios-ia.tsx).
    // A chance por candidato fica em candidates[].winsOutrightProbability.
    outrightWinProbability,
    runoffProbability,
    reportedPercentageSum,
    unallocatedPercentage,
    completenessWarning,
    methodologyNote: methodologyNote({ marginPp: effectiveMarginPp, marginSource, n }),
    sourcePoll: { ...sourcePoll, marginOfErrorPp: effectiveMarginPp, marginSource },
    ideologySource: ideologySourceCitation(ideologyFile),
  }
}
