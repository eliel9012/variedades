// Cliente fino para um servidor de LLM local compativel com a API da OpenAI
// (funciona tanto com llama-swap/llama-server quanto com Ollama, que tambem
// expoe /v1/chat/completions). Nao fabrica resposta nenhuma: se o servidor
// estiver fora do ar ou o modelo nao existir, propaga um erro claro para a
// camada HTTP (server/index.mjs) tratar como 503 honesto, nunca como
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

/**
 * Chama POST /v1/chat/completions (stream:false). Lança um Error com uma
 * mensagem clara se o modelo não estiver configurado (LLM_MODEL ausente), se
 * o servidor não responder, ou se a resposta não tiver o formato esperado.
 * server/index.mjs captura esse erro e devolve 503 com um corpo honesto,
 * nunca uma resposta fabricada.
 *
 * @param {{ systemPrompt: string, userMessage: string }} params
 * @returns {Promise<string>} o texto da resposta do modelo
 */
export async function askOllama({ systemPrompt, userMessage }) {
  const model = getLlmModel()
  if (!model) {
    throw new Error(
      'LLM_MODEL não está definido. Defina a variável de ambiente LLM_MODEL com o nome de um modelo disponível no servidor configurado em LLM_URL (ex.: LLM_MODEL=gpt-oss-20b).',
    )
  }
  const url = getLlmUrl()
  let response
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    response = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))
  } catch (error) {
    throw new Error(
      `Não foi possível conectar ao servidor de LLM em ${url}. Confirme que ele está rodando e que LLM_URL aponta pro lugar certo. Detalhe: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw new Error(
      `O servidor de LLM respondeu ${response.status} para o modelo "${model}". Confirme que esse modelo existe no servidor configurado. Detalhe: ${bodyText.slice(0, 300)}`,
    )
  }

  const data = await response.json().catch(() => null)
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('O servidor de LLM respondeu em um formato inesperado (sem choices[0].message.content).')
  }
  return content
}
