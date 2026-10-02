// Cliente fino para uma instancia local do Ollama (https://ollama.com).
// Nao fabrica resposta nenhuma: se o Ollama estiver fora do ar ou o modelo
// nao estiver baixado, propaga um erro claro para a camada HTTP (server/index.mjs)
// tratar como 503 honesto, nunca como resposta encenada.

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'

function getOllamaUrl() {
  return process.env.OLLAMA_URL?.trim() || DEFAULT_OLLAMA_URL
}

function getOllamaModel() {
  return process.env.OLLAMA_MODEL?.trim() || null
}

/** GET /api/tags - usado só para checar se o Ollama está respondendo
 * (server/index.mjs -> GET /api/health). Nunca lança: retorna false em
 * qualquer falha (timeout, conexão recusada, etc). */
export async function pingOllama() {
  const url = getOllamaUrl()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const response = await fetch(`${url}/api/tags`, { signal: controller.signal })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

/**
 * Chama POST /api/chat do Ollama local (stream:false). Lança um Error com
 * uma mensagem clara se o modelo não estiver configurado (OLLAMA_MODEL
 * ausente), se o Ollama não responder, ou se a resposta não tiver o formato
 * esperado. server/index.mjs captura esse erro e devolve 503 com um corpo
 * honesto -- nunca uma resposta fabricada.
 *
 * @param {{ systemPrompt: string, userMessage: string }} params
 * @returns {Promise<string>} o texto da resposta do modelo
 */
export async function askOllama({ systemPrompt, userMessage }) {
  const model = getOllamaModel()
  if (!model) {
    throw new Error(
      'OLLAMA_MODEL não está definido. Defina a variável de ambiente OLLAMA_MODEL com o nome de um modelo já baixado (ex.: OLLAMA_MODEL=llama3.1 npm run server).',
    )
  }
  const url = getOllamaUrl()
  let response
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    response = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      `Não foi possível conectar ao Ollama local em ${url}. Rode "ollama serve" e confirme a URL (variável OLLAMA_URL). Detalhe: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw new Error(
      `Ollama respondeu ${response.status} para o modelo "${model}". Confirme que o modelo foi baixado (ollama pull ${model}). Detalhe: ${bodyText.slice(0, 300)}`,
    )
  }

  const data = await response.json().catch(() => null)
  const content = data?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Ollama respondeu em um formato inesperado (sem message.content).')
  }
  return content
}
