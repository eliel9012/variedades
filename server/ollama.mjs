// Cliente fino para um servidor de LLM local compativel com a API da OpenAI
// (funciona tanto com llama-swap/llama-server quanto com Ollama, que tambem
// expoe /v1/chat/completions). Nao fabrica resposta nenhuma: se o servidor
// estiver fora do ar ou o modelo nao existir, propaga um LlmError tipado para
// a camada HTTP (server/index.mjs) mapear num status honesto, nunca numa
// resposta encenada.

const DEFAULT_LLM_URL = 'http://127.0.0.1:11434'

function getLlmUrl() {
  return (process.env.LLM_URL || process.env.OLLAMA_URL)?.trim() || DEFAULT_LLM_URL
}

function getLlmModel() {
  return (process.env.LLM_MODEL || process.env.OLLAMA_MODEL)?.trim() || null
}

function getLlmApiKey() {
  return (process.env.LLM_API_KEY || process.env.LLAMA_API_KEY)?.trim() || null
}

function authHeaders() {
  const key = getLlmApiKey()
  return key ? { Authorization: `Bearer ${key}` } : {}
}

/** GET /v1/models - usado só para checar se o servidor de LLM está
 * respondendo (server/index.mjs -> GET /api/health). Nunca lança: retorna
 * false em qualquer falha (timeout, conexão recusada, 401, etc). */
export async function pingOllama() {
  const url = getLlmUrl()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const response = await fetch(`${url}/v1/models`, { headers: authHeaders(), signal: controller.signal })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

/** Erro tipado do cliente de LLM. `code` permite a camada HTTP
 * (server/index.mjs) escolher o status certo (413/502/503/499) e devolver ao
 * navegador uma mensagem generica, sem vazar URL interna; `detail` (com URL,
 * corpo da resposta etc.) fica so no log do servidor. */
export class LlmError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.detail = detail ?? message
  }
}

const CONTEXT_EXCEEDED_RE = /context|n_ctx|too long|exceed|maximum.*tokens|prompt is too/i

/**
 * Chama POST /v1/chat/completions (stream:false). Lança LlmError com `code`:
 *   - 'not_configured'   LLM_MODEL ausente
 *   - 'aborted'          cliente desconectou (signal externo abortou)
 *   - 'timeout'          servidor de LLM não respondeu a tempo
 *   - 'unreachable'      falha de conexão
 *   - 'context_exceeded' prompt maior que a janela de contexto do modelo
 *   - 'http_error'       outro status de erro do servidor de LLM
 *   - 'bad_response'     resposta sem choices[0].message.content
 * server/index.mjs mapeia cada código para um status HTTP honesto, nunca uma
 * resposta fabricada.
 *
 * @param {{ systemPrompt: string, userMessage: string, signal?: AbortSignal }} params
 * @returns {Promise<{ content: string, usage: object | null }>}
 */
export async function askOllama({ systemPrompt, userMessage, signal }) {
  const model = getLlmModel()
  if (!model) {
    throw new LlmError(
      'not_configured',
      'LLM_MODEL não está definido.',
      'LLM_MODEL não está definido. Defina a variável de ambiente LLM_MODEL com o nome de um modelo disponível no servidor configurado em LLM_URL (ex.: LLM_MODEL=gpt-oss-20b).',
    )
  }
  const url = getLlmUrl()
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 120_000)
  const onExternalAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    let response
    try {
      response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          model,
          stream: false,
          temperature: 0.2,
          max_tokens: 1500,
          // gpt-oss aceita reasoning_effort; servidores que não conhecem o
          // campo simplesmente o ignoram.
          reasoning_effort: 'low',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
        signal: controller.signal,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (signal?.aborted) throw new LlmError('aborted', 'Requisição cancelada pelo cliente.')
      if (timedOut) throw new LlmError('timeout', 'O servidor de LLM demorou demais para responder.', `Timeout (120s) em ${url}: ${msg}`)
      throw new LlmError('unreachable', 'Servidor de LLM indisponível.', `Falha ao conectar em ${url}: ${msg}`)
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      const detail = `LLM respondeu ${response.status} (modelo "${model}", ${url}): ${bodyText.slice(0, 500)}`
      if ((response.status === 400 || response.status === 413) && CONTEXT_EXCEEDED_RE.test(bodyText)) {
        throw new LlmError('context_exceeded', 'A pergunta mais o contexto excederam o limite do modelo.', detail)
      }
      if (response.status >= 500 || response.status === 404) {
        throw new LlmError('unreachable', 'Servidor de LLM indisponível.', detail)
      }
      throw new LlmError('http_error', 'O servidor de LLM recusou a requisição.', detail)
    }

    let data
    try {
      data = await response.json()
    } catch (error) {
      if (signal?.aborted) throw new LlmError('aborted', 'Requisição cancelada pelo cliente.')
      throw new LlmError('bad_response', 'Resposta inesperada do servidor de LLM.', `JSON inválido: ${error instanceof Error ? error.message : String(error)}`)
    }
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new LlmError(
        'bad_response',
        'Resposta inesperada do servidor de LLM.',
        `Sem choices[0].message.content (finish_reason=${data?.choices?.[0]?.finish_reason ?? '?'}).`,
      )
    }
    return { content, usage: data?.usage ?? null }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}
