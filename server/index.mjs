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
// /api/ask so falha (503, corpo claro) se o Ollama estiver fora do ar -- nunca
// inventa uma resposta.

import http from 'node:http'
import crypto from 'node:crypto'
import { computeScenario } from './scenario.mjs'
import { pingOllama, askOllama } from './ollama.mjs'

const PORT = Number(process.env.PORT) || 8790
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
  if (!header || !header.startsWith('Basic ')) return false
  let decoded
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  } catch {
    return false
  }
  const sep = decoded.indexOf(':')
  if (sep === -1) return false
  const user = decoded.slice(0, sep)
  const pass = decoded.slice(sep + 1)
  return timingSafeEqual(user, AI_AUTH_USER) && timingSafeEqual(pass, AI_AUTH_PASS)
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

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('Corpo da requisição não é JSON válido.')
  }
}

const SYSTEM_PROMPT_TEMPLATE = (contextJson) => `Você responde perguntas sobre pesquisas eleitorais brasileiras de 2026 (Presidente e Governador).

Regras obrigatórias, sem exceção:
1. Você está respondendo sobre pesquisas eleitorais do Brasil em 2026, não sobre nenhum outro país ou ano.
2. Os ÚNICOS números que você pode citar são os que aparecem no bloco JSON de contexto abaixo. Nunca calcule, estime ou invente um número que não esteja literalmente nesse JSON.
3. Se a pergunta for sobre uma probabilidade (chance de vencer, chance de ir para o 2º turno, chance de vitória em 1º turno), repita literalmente os valores já calculados nos campos "leadProbability", "outrightWinProbability" ou "runoffProbability" do JSON. Você NUNCA calcula ou estima sua própria probabilidade.
4. Se o JSON de contexto não contiver algo que foi perguntado, diga isso claramente em português (por exemplo "não tenho esse dado") em vez de chutar ou inventar.
5. Sempre mencione que isto é uma estimativa estatística simples a partir de uma única pesquisa, não uma previsão eleitoral.
6. Sobre classificação ideológica de partido (esquerda/centro/direita): você SÓ pode afirmar a classificação ideológica de um partido quando o candidato correspondente, no JSON de contexto, tiver o campo "ideology" preenchido (não nulo) E o campo "ideologyAvailable" igual a true. Nesse caso, você é OBRIGADO a atribuir essa classificação à fonte indicada no campo "ideologySource" do JSON (por exemplo: "segundo classificação de [ideologySource.publisher], '[ideologySource.title]' [ideologySource.year]"), nunca apresentando isso como fato do site ou como sua própria opinião. Se "ideology" for null ou "ideologyAvailable" for false, diga explicitamente que essa classificação não está disponível nesta fonte, em vez de preencher a lacuna com conhecimento geral. Você NUNCA deve usar seu conhecimento pré-treinado/geral sobre o espectro político de partidos brasileiros para responder perguntas desse tipo: use exclusivamente o campo "ideology"/"ideologyAvailable" de cada candidato e a citação em "ideologySource", ambos fornecidos no JSON de contexto abaixo.

Contexto (única fonte de verdade, em JSON):
${contextJson}`

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
        sendJson(res, 400, { error: 'invalid_body', detail: error instanceof Error ? error.message : String(error) })
        return
      }
      const question = typeof body.question === 'string' ? body.question.trim() : ''
      if (!question) {
        sendJson(res, 400, { error: 'invalid_request', detail: 'Campo "question" é obrigatório.' })
        return
      }
      const office = typeof body.office === 'string' ? body.office : 'Presidente'
      const uf = typeof body.uf === 'string' && body.uf !== 'BR' ? body.uf.toUpperCase() : null

      let scenario
      try {
        scenario = await computeScenario({ office, uf })
      } catch (error) {
        sendJson(res, 400, { error: 'invalid_request', detail: error instanceof Error ? error.message : String(error) })
        return
      }

      const systemPrompt = SYSTEM_PROMPT_TEMPLATE(JSON.stringify(scenario))
      try {
        const answer = await askOllama({ systemPrompt, userMessage: question })
        sendJson(res, 200, { answer, scenario, groundedOn: 'local-data' })
      } catch (error) {
        sendJson(res, 503, { error: 'ollama_unreachable', detail: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    sendJson(res, 404, { error: 'not_found' })
  } catch (error) {
    sendJson(res, 500, { error: 'internal_error', detail: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(PORT, () => {
  console.log(`Cenarios (IA) server ouvindo em http://127.0.0.1:${PORT}`)
  console.log(`Basic Auth usuario: ${AI_AUTH_USER}`)
  if (PASSWORD_WAS_GENERATED) {
    console.log(`Senha gerada automaticamente (AI_AUTH_PASS não definida): ${AI_AUTH_PASS}`)
    console.log('Defina AI_AUTH_PASS para fixar uma senha entre reinicializações.')
  }
})
