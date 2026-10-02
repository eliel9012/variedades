// Servidor HTTP simples (node:http puro, sem Express/dependencia nova) para
// o companion local de "Cenarios (IA)". Expoe:
//   GET  /api/health    -> { ok, ollamaReachable }
//   GET  /api/scenario  -> numeros deterministicos de server/scenario.mjs
//   POST /api/ask       -> pergunta livre, respondida pelo Ollama local, mas
//                          sempre "grounded" no mesmo JSON de /api/scenario
//
// Protegido por HTTP Basic Auth em TODAS as rotas /api/* (inclusive /api/health),
// porque este processo pode rodar num servidor publico (varia.meulab.fun), nao
// so em localhost. Ver README para como configurar AI_AUTH_USER/AI_AUTH_PASS.
//
// /api/scenario NUNCA depende do Ollama: funciona mesmo sem ele instalado.
// /api/ask so falha (status honesto: 413/429/502/503, corpo claro e generico,
// detalhe interno so no log) se o LLM estiver fora do ar ou sobrecarregado --
// nunca inventa uma resposta.

import http from 'node:http'
import crypto from 'node:crypto'
import { computeScenario, buildPresidenteEstadosSummary, buildGovernadorEstadosSummary } from './scenario.mjs'
import { pingOllama, askOllama, LlmError } from './ollama.mjs'
import { loadPresidenteHistorico } from './data.mjs'

const PORT = Number(process.env.PORT) || 8790
// So localhost: o acesso publico passa pelo proxy do Vite (/api -> 127.0.0.1:8790).
const HOST = process.env.HOST?.trim() || '127.0.0.1'
const MAX_BODY_BYTES = 16 * 1024
const MAX_QUESTION_CHARS = 1000
const AI_AUTH_USER = process.env.AI_AUTH_USER?.trim() || 'admin'
const AI_AUTH_PASS_ENV = process.env.AI_AUTH_PASS
const AI_AUTH_PASS = AI_AUTH_PASS_ENV && AI_AUTH_PASS_ENV.length > 0 ? AI_AUTH_PASS_ENV : crypto.randomBytes(15).toString('base64url')
const PASSWORD_WAS_GENERATED = !(AI_AUTH_PASS_ENV && AI_AUTH_PASS_ENV.length > 0)

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    // Ainda compara contra um buffer do mesmo tamanho de bufA para nao vazar
    // o comprimento esperado via timing; o resultado sera sempre falso aqui.
    crypto.timingSafeEqual(bufA, bufA)
    return false
  }
  return crypto.timingSafeEqual(bufA, bufB)
}

function checkBasicAuth(req) {
  const header = req.headers.authorization
  if (!header || !/^basic /i.test(header)) return false
  let decoded
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8')
  } catch {
    return false
  }
  const sep = decoded.indexOf(':')
  if (sep === -1) return false
  const user = decoded.slice(0, sep)
  const pass = decoded.slice(sep + 1)
  // Calcula as duas comparacoes antes de combinar (sem curto-circuito), para
  // o tempo nao revelar se o usuario estava certo.
  const userOk = timingSafeEqual(user, AI_AUTH_USER)
  const passOk = timingSafeEqual(pass, AI_AUTH_PASS)
  return userOk && passOk
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(payload)
}

function sendUnauthorized(res) {
  res.setHeader('WWW-Authenticate', 'Basic realm="Cenarios IA"')
  res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Autenticação necessária para usar a API de Cenários (IA).')
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Le o corpo como JSON com teto de MAX_BODY_BYTES (413 acima disso). */
async function readJsonBody(req) {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpError(413, 'payload_too_large', `Corpo da requisição maior que ${MAX_BODY_BYTES / 1024} KB.`)
  }
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      throw new HttpError(413, 'payload_too_large', `Corpo da requisição maior que ${MAX_BODY_BYTES / 1024} KB.`)
    }
    chunks.push(chunk)
  }
  if (!chunks.length) return undefined
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'invalid_body', 'Corpo da requisição não é JSON válido.')
  }
}

// ---------------------------------------------------------------------------
// Fila do LLM: concorrencia 1 (um unico modelo local, chamadas em paralelo so
// disputariam a mesma GPU). Ate MAX_QUEUE_WAITING esperando; acima disso, 429.
// ---------------------------------------------------------------------------
const MAX_QUEUE_WAITING = 3
let llmBusy = false
const llmWaiting = []

/** Pega a vez na fila. Retorna uma funcao release(), ou lanca HttpError 429
 * se a fila estiver cheia. Se `signal` abortar enquanto espera, sai da fila. */
function acquireLlmSlot(signal) {
  if (!llmBusy) {
    llmBusy = true
    return Promise.resolve(releaseLlmSlot)
  }
  if (llmWaiting.length >= MAX_QUEUE_WAITING) {
    return Promise.reject(
      new HttpError(429, 'busy', 'A IA local está ocupada respondendo outras perguntas. Tente de novo em alguns segundos.'),
    )
  }
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject }
    llmWaiting.push(entry)
    signal?.addEventListener(
      'abort',
      () => {
        const i = llmWaiting.indexOf(entry)
        if (i !== -1) {
          llmWaiting.splice(i, 1)
          reject(new LlmError('aborted', 'Requisição cancelada pelo cliente.'))
        }
      },
      { once: true },
    )
  })
}

function releaseLlmSlot() {
  const next = llmWaiting.shift()
  if (next) next.resolve(releaseLlmSlot)
  else llmBusy = false
}

// ---------------------------------------------------------------------------
// Contexto compacto para o LLM (chaves curtas, documentadas no prompt; campos
// nulos removidos). Ordem pensada para reuso de KV cache: regras fixas e
// resumos por estado (identicos em toda pergunta) primeiro, recorte atual e
// observacoes por ultimo.
// ---------------------------------------------------------------------------

/** Remove chaves com valor null/undefined (raso). */
function dropNulls(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined))
}

/** Probabilidade para o contexto da IA, ja em texto: a simulacao nunca da
 * certeza absoluta, entao 1 vira "acima de 99,9%" e 0 vira "abaixo de 0,1%"
 * (assim o LLM nao tem como escrever 100% ou 0%). */
function pctProb(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value >= 0.9995) return 'acima de 99,9%'
  if (value <= 0.0005) return 'abaixo de 0,1%'
  return `${(Math.round(value * 1000) / 10).toLocaleString('pt-BR')}%`
}

/** Resumo por UF indexado pela sigla ({ SP: {...} }): o LLM acha a UF direto
 * em vez de varrer um array de 27 linhas. */
function summaryByUf(rows) {
  return Object.fromEntries(rows.map((row) => {
    const { uf, ...rest } = compactSummaryRow(row)
    return [uf, rest]
  }))
}

function compactSummaryRow(row) {
  const lider = dropNulls({
    nome: row.leadingCandidate,
    partido: row.leadingCandidateParty,
    pct: row.leadingCandidatePercentage,
    pLidera: row.simulatable ? pctProb(row.leadingCandidateLeadProbability) : null,
    pVence1T: row.simulatable ? pctProb(row.leadingCandidateWinsOutrightProbability) : null,
  })
  if (!row.simulatable) return dropNulls({ uf: row.uf, lider, simulavel: false, onda: row.pollWave })
  return dropNulls({
    uf: row.uf,
    lider,
    pAlguem1T: pctProb(row.anyCandidateOutrightWinProbability),
    p2T: pctProb(row.runoffProbability),
    onda: row.pollWave,
  })
}

function compactScenario(scenario) {
  const sp = scenario.sourcePoll ?? {}
  return dropNulls({
    cargo: scenario.office,
    uf: scenario.uf,
    simulavel: scenario.simulatable,
    motivo: scenario.reason,
    candidatos: scenario.candidates.map((c) =>
      dropNulls({
        nome: c.candidateName,
        partido: c.party,
        pct: c.percentage,
        pLidera: pctProb(c.leadProbability),
        pVence1T: pctProb(c.winsOutrightProbability),
        ideologia: c.ideologyAvailable ? c.ideology : null,
      }),
    ),
    pAlguem1T: pctProb(scenario.outrightWinProbability),
    p2T: pctProb(scenario.runoffProbability),
    somaPct: scenario.reportedPercentageSum,
    naoAlocadoPct: scenario.unallocatedPercentage,
    aviso: scenario.completenessWarning,
    pesquisa: dropNulls({
      instituto: sp.pollster,
      contratante: sp.commissioner,
      campo: sp.fieldwork,
      publicadoEm: sp.publishedAt,
      onda: sp.vintage ?? sp.scenarioLabel,
      avisoOnda: sp.waveNote,
      amostra: sp.sampleSize,
      margemPp: typeof sp.marginOfErrorPp === 'number' ? Math.round(sp.marginOfErrorPp * 10) / 10 : null,
      margemEstimada: sp.marginSource === 'estimated_from_sample_size' ? true : null,
      url: sp.sourceUrl,
    }),
  })
}

/** Historico 2018/2022/2026 compacto: por UF, arrays de % alinhados aos anos;
 * legenda (nome/partido por serie e ano, e se e pesquisa) gerada a partir do
 * proprio arquivo, nunca escrita a mao. */
function compactHistorico(file) {
  const series = ['pt', 'bolsonaro', 'outros']
  const years = [...new Set(file.states.flatMap((s) => series.flatMap((k) => (s[k] ?? []).map((p) => p.year))))].sort()
  const legend = {}
  for (const k of series) {
    legend[k] = years.map((y) => {
      const names = new Set()
      let isPoll = null
      for (const s of file.states) {
        const point = (s[k] ?? []).find((p) => p.year === y)
        if (point) {
          names.add(point.party ? `${point.candidateName} (${point.party})` : point.candidateName)
          isPoll = point.isPoll
        }
      }
      return `${y}: ${[...names].join(' / ') || 'sem dado'}${isPoll ? ' [PESQUISA]' : ' [resultado TSE]'}`
    })
  }
  const estados = file.states.map((s) => {
    const row = { uf: s.uf }
    for (const k of series) row[k] = years.map((y) => (s[k] ?? []).find((p) => p.year === y)?.percentage ?? null)
    return row
  })
  return { anos: years, legenda: legend, estados }
}

const HISTORICO_RE = /2018|2022|hist[óo]ric|haddad|bolsonaro|elei[çc][ãa]o passada|elei[çc][õo]es passadas|[úu]ltima elei[çc][ãa]o/i

const SYSTEM_RULES = `Você responde perguntas sobre pesquisas eleitorais brasileiras de 2026 (Presidente e Governador).

Glossário das chaves do JSON (probabilidades já vêm em texto com %; pct é % da pesquisa):
- Em qualquer candidato: nome, partido, pct = % na pesquisa, pLidera = chance de terminar em 1º, pVence1T = chance DESTE candidato vencer no 1º turno (mais de 50% dos válidos).
- Em qualquer disputa: pAlguem1T = chance de QUALQUER candidato vencer no 1º turno (nível da disputa, nunca de um candidato); p2T = chance de haver 2º turno; onda = rodada/data da pesquisa; simulavel:false = sem probabilidade, só o % bruto.
- presidenteBrasil: cenário NACIONAL de Presidente (mesmo formato do recorte), sempre presente. Perguntas sobre Presidente sem UF ("Lula vence no 1º turno?") se respondem com ele, nunca com os resumos por UF.
- presidenteEstados (disputa para Presidente, votos de cada UF) / governadorEstados (disputa para Governador de cada UF): objetos indexados pela sigla da UF (ex.: governadorEstados.SP), cada um com lider (só o candidato que lidera, com os campos acima), pAlguem1T, p2T, onda. Outros candidatos da UF não estão nesses resumos.
- recorte: cenário aberto na tela (um único cargo e UF, indicados em cargo e uf). candidatos[] (com os campos acima e ideologia), pAlguem1T, p2T, somaPct, naoAlocadoPct, aviso, motivo, pesquisa (instituto, contratante, campo, publicadoEm, onda, avisoOnda, amostra, margemPp, margemEstimada, url).
- fonteIdeologia: citação da classificação ideológica.
- historicoPresidencial (só quando presente): anos, legenda por série (pt, bolsonaro, outros) e estados[] com % alinhados aos anos.
- observacao: aviso sobre a pergunta (ex.: cargo sem cenário).

Regras obrigatórias, sem exceção:
1. O assunto é pesquisa eleitoral do Brasil em 2026, nenhum outro país ou ano (exceto o histórico, regra 8).
2. Os ÚNICOS números que você pode citar são os que aparecem no JSON abaixo. Nunca calcule, estime ou invente número que não esteja literalmente no JSON. As probabilidades já vêm em texto ("79,2%", "acima de 99,9%"): repita exatamente esse texto.
3. Probabilidades: repita os valores já calculados (pLidera, pVence1T, pAlguem1T, p2T) do MESMO objeto do candidato/disputa citado. Nunca calcule a sua e nunca misture números de cargos ou UFs diferentes. "X vence no 1º turno?" se responde com o pVence1T de X. pAlguem1T é da disputa: nunca o atribua a um candidato. Se X não estiver no recorte nem como lider num resumo, diga que não tem a probabilidade de X.
4. Se o JSON não contiver o que foi perguntado, diga claramente qual dado não tem (ex.: "não tenho pesquisa de Senado") em vez de chutar, e ofereça o que houver de relacionado no JSON.
5. Sempre mencione que é uma estimativa estatística simples a partir de uma única pesquisa, não uma previsão eleitoral.
6. Ideologia de partido (esquerda/centro/direita): só afirme quando o candidato tiver o campo "ideologia" no recorte, e atribua à fonte em fonteIdeologia ("segundo classificação de [publisher], '[title]' [year]"). Sem o campo "ideologia", diga que essa classificação não está disponível nesta fonte. Nunca use conhecimento geral sobre o espectro político de partidos.
7. A pergunta pode citar um candidato sem dizer o cargo, sem acento ou só pelo primeiro nome (ex.: "Tarcisio" = "Tarcísio de Freitas"): procure o nome em recorte, presidenteEstados e governadorEstados (na UF citada) antes de dizer que não tem o dado. Pergunta sobre outro estado ou outro cargo diferente do recorte: use SOMENTE presidenteEstados (Presidente por UF) e governadorEstados (Governador por UF). Linhas com simulavel:false têm só o % bruto: não trate como liderança estatística nem invente probabilidade. UF ou cargo ausente: diga que não tem esse dado. Não há dados de Senado, Câmara ou outros cargos.
8. historicoPresidencial (quando presente) cobre SÓ a corrida de Presidente por estado: anos marcados [resultado TSE] são resultado OFICIAL de 1º turno (% de votos válidos) e [PESQUISA] é intenção de voto, não resultado; não trate os dois como igualmente certos. "outros" agrega nomes diferentes em cada estado. Nunca use esse campo para Governador, Senado ou candidatos fora das séries pt/bolsonaro, e nunca misture com governadorEstados numa mesma resposta.
9. Responda em português, de forma direta e curta.
10. Nunca escreva os nomes das chaves do JSON (pVence1T, pLidera, pAlguem1T, p2T, lider, recorte etc.) na resposta: use linguagem natural ("chance de vencer no 1º turno"). Ao usar um resumo por UF, diga o cargo daquele resumo (governadorEstados = "disputa para Governador de <UF>"), nunca o cargo do recorte da tela.
11. Nunca escreva 100% ou 0% para probabilidade: a simulação nunca dá certeza absoluta.

Contexto (única fonte de verdade, em JSON). Blocos fixos primeiro, recorte atual por último:`

/** Monta o system prompt: regras + blocos estaveis (resumos) + blocos
 * variaveis (historico condicional, recorte, observacao). */
function buildSystemPrompt({ presidenteBrasil, presidenteEstados, governadorEstados, historico, scenario, ideologySource, note }) {
  const parts = [SYSTEM_RULES]
  if (presidenteBrasil) parts.push(`presidenteBrasil=${JSON.stringify(presidenteBrasil)}`)
  if (presidenteEstados) parts.push(`presidenteEstados=${JSON.stringify(presidenteEstados)}`)
  if (governadorEstados) parts.push(`governadorEstados=${JSON.stringify(governadorEstados)}`)
  if (ideologySource) parts.push(`fonteIdeologia=${JSON.stringify(ideologySource)}`)
  if (historico) parts.push(`historicoPresidencial=${JSON.stringify(historico)}`)
  parts.push(`recorte=${JSON.stringify(scenario)}`)
  if (note) parts.push(`observacao=${JSON.stringify(note)}`)
  return parts.join('\n')
}

/** Mapeia LlmError -> status HTTP + corpo generico (sem URL interna). */
function llmErrorResponse(error) {
  const code = error instanceof LlmError ? error.code : 'unknown'
  switch (code) {
    case 'context_exceeded':
      return [413, { error: 'context_too_large', detail: 'A pergunta ficou grande demais para o modelo. Tente uma pergunta mais curta.' }]
    case 'unreachable':
      return [503, { error: 'llm_unavailable', detail: 'A IA local está indisponível no momento. Tente novamente em instantes.' }]
    case 'timeout':
      return [504, { error: 'llm_timeout', detail: 'A IA local demorou demais para responder. Tente novamente.' }]
    case 'not_configured':
      return [503, { error: 'llm_not_configured', detail: 'A IA local não está configurada neste servidor.' }]
    case 'http_error':
    case 'bad_response':
      return [502, { error: 'llm_bad_gateway', detail: 'A IA local respondeu de forma inesperada. Tente novamente.' }]
    default:
      return [500, { error: 'internal_error', detail: 'Erro interno ao consultar a IA local.' }]
  }
}

const server = http.createServer(async (req, res) => {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)

  if (!url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  if (!checkBasicAuth(req)) {
    sendUnauthorized(res)
    return
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const ollamaReachable = await pingOllama()
      sendJson(res, 200, { ok: true, ollamaReachable })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/scenario') {
      const office = url.searchParams.get('office')
      const ufParam = url.searchParams.get('uf')
      const uf = !ufParam || ufParam === 'BR' ? null : ufParam.toUpperCase()
      try {
        const scenario = await computeScenario({ office, uf })
        sendJson(res, 200, scenario)
      } catch (error) {
        sendJson(res, 400, { error: 'invalid_request', detail: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/ask') {
      let body
      try {
        body = await readJsonBody(req)
      } catch (error) {
        if (error instanceof HttpError) sendJson(res, error.status, { error: error.code, detail: error.message })
        else sendJson(res, 400, { error: 'invalid_body', detail: 'Não foi possível ler o corpo da requisição.' })
        return
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'invalid_body', detail: 'O corpo precisa ser um objeto JSON, ex.: {"question": "..."}.' })
        return
      }
      const question = typeof body.question === 'string' ? body.question.trim() : ''
      if (!question) {
        sendJson(res, 400, { error: 'invalid_request', detail: 'Campo "question" é obrigatório.' })
        return
      }
      if (question.length > MAX_QUESTION_CHARS) {
        sendJson(res, 400, { error: 'question_too_long', detail: `A pergunta pode ter no máximo ${MAX_QUESTION_CHARS} caracteres.` })
        return
      }
      const requestedOffice = typeof body.office === 'string' && body.office.trim() ? body.office.trim() : 'Presidente'
      const uf = typeof body.uf === 'string' && body.uf !== 'BR' ? body.uf.toUpperCase() : null

      // Cargo sem cenario (ex.: Senado): nao recusa a pergunta; usa
      // Presidente/Nacional como recorte base e avisa o LLM, que ainda pode
      // responder pelos resumos por estado ou dizer que nao tem o dado.
      let note = null
      let office = requestedOffice
      let scenarioUf = uf
      if (office !== 'Presidente' && office !== 'Governador') {
        note = `O cargo "${requestedOffice}" não tem cenário em Cenários (IA) (só Presidente e Governador). O recorte abaixo é Presidente/Nacional, usado só como base: diga que não tem dados de ${requestedOffice} e responda apenas com o que estiver no JSON.`
        office = 'Presidente'
        scenarioUf = null
      }

      let scenario
      try {
        scenario = await computeScenario({ office, uf: scenarioUf })
      } catch (error) {
        sendJson(res, 400, { error: 'invalid_request', detail: error instanceof Error ? error.message : String(error) })
        return
      }

      // Contexto cruzado: sempre inclui os resumos de Presidente e Governador
      // por estado (assim "Tarcisio vence no 1o turno em SP?" funciona com a
      // tela em Presidente/Nacional, e vice-versa). O historico 2018/2022 so
      // entra quando a pergunta fala dele (economiza ~8k tokens). Cada bloco
      // falha isoladamente, nunca derruba a pergunta principal.
      let presidenteBrasil = null
      let presidenteEstados = null
      let governadorEstados = null
      let historico = null
      try {
        presidenteBrasil = compactScenario(await computeScenario({ office: 'Presidente', uf: null }))
      } catch {
        // Cenario nacional indisponivel: segue sem ele.
      }
      try {
        presidenteEstados = summaryByUf(await buildPresidenteEstadosSummary())
      } catch {
        // Resumo indisponivel: segue sem ele.
      }
      try {
        governadorEstados = summaryByUf(await buildGovernadorEstadosSummary())
      } catch {
        // Resumo indisponivel: segue sem ele.
      }
      if (HISTORICO_RE.test(question)) {
        try {
          historico = compactHistorico(await loadPresidenteHistorico())
        } catch {
          // Historico indisponivel: segue sem ele.
        }
      }

      const systemPrompt = buildSystemPrompt({
        presidenteBrasil,
        presidenteEstados,
        governadorEstados,
        historico,
        scenario: compactScenario(scenario),
        ideologySource: scenario.ideologySource ?? null,
        note,
      })

      // Cancela a chamada ao LLM (ou sai da fila) se o cliente desconectar.
      const abort = new AbortController()
      const onClose = () => {
        if (!res.writableFinished) abort.abort()
      }
      res.on('close', onClose)

      const started = Date.now()
      let release = null
      try {
        release = await acquireLlmSlot(abort.signal)
        const { content, usage } = await askOllama({ systemPrompt, userMessage: question, signal: abort.signal })
        const latencyMs = Date.now() - started
        console.log(
          `[ask] ok ${latencyMs}ms prompt_tokens=${usage?.prompt_tokens ?? '?'} completion_tokens=${usage?.completion_tokens ?? '?'} historico=${historico ? 1 : 0}`,
        )
        const payload = { answer: content, scenario, groundedOn: 'local-data', latencyMs, usage }
        if (note) payload.note = note
        sendJson(res, 200, payload)
      } catch (error) {
        if (error instanceof HttpError) {
          sendJson(res, error.status, { error: error.code, detail: error.message })
          return
        }
        if (error instanceof LlmError && error.code === 'aborted') {
          console.log(`[ask] cancelada pelo cliente apos ${Date.now() - started}ms`)
          return
        }
        console.error(`[ask] erro LLM (${error instanceof LlmError ? error.code : 'unknown'}):`, error instanceof LlmError ? error.detail : error)
        const [status, errBody] = llmErrorResponse(error)
        if (!res.writableEnded && !res.destroyed) sendJson(res, status, errBody)
      } finally {
        res.off('close', onClose)
        if (release) release()
      }
      return
    }

    sendJson(res, 404, { error: 'not_found' })
  } catch (error) {
    console.error('[server] erro interno:', error)
    if (!res.headersSent) sendJson(res, 500, { error: 'internal_error', detail: 'Erro interno do servidor.' })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Cenarios (IA) server ouvindo em http://${HOST}:${PORT}`)
  console.log(`Basic Auth usuario: ${AI_AUTH_USER}`)
  if (PASSWORD_WAS_GENERATED) {
    console.log(`Senha gerada automaticamente (AI_AUTH_PASS não definida): ${AI_AUTH_PASS}`)
    console.log('Defina AI_AUTH_PASS para fixar uma senha entre reinicializações.')
  }
})
