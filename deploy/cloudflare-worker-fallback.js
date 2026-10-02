// Worker na frente de eleicoes.meulab.fun (só HTML e /data; /tse, /assets e
// /api ficam fora por rota): se a origem (esta máquina, via túnel) cair, entrega
// a última cópia boa do site. O front, sem espelho do TSE atualizado, passa a
// buscar a apuração direto no TSE, então o site segue funcionando.
//
// Cópias ficam no Cache API do Cloudflare (por data center), com chave fixa:
// todas as rotas da SPA usam o mesmo index.html. passThroughOnException: se o
// Worker der erro, a requisição segue direto para a origem como se ele não
// existisse.

const FALLBACK_TTL = 7 * 24 * 3600

function fallbackKey(url) {
  // Rotas da SPA (sem extensão) compartilham a cópia do index.html.
  const isSpaRoute = !/\.[a-z0-9]+$/i.test(url.pathname)
  return new Request(`https://apura-fallback.internal${isSpaRoute ? '/__spa__' : url.pathname}`)
}

export default {
  async fetch(request, env, ctx) {
    ctx.passThroughOnException()
    if (request.method !== 'GET') return fetch(request)
    const url = new URL(request.url)
    const key = fallbackKey(url)
    const cache = caches.default

    let response
    try {
      response = await fetch(request)
    } catch {
      response = null
    }

    if (response && response.status < 500) {
      if (response.status === 200) {
        const copy = new Response(response.clone().body, response)
        copy.headers.set('cache-control', `public, max-age=${FALLBACK_TTL}`)
        copy.headers.delete('set-cookie')
        ctx.waitUntil(cache.put(key, copy))
      }
      return response
    }

    const cached = await cache.match(key)
    if (cached) {
      const out = new Response(cached.body, cached)
      out.headers.set('cache-control', 'no-store')
      out.headers.set('x-apura-fallback', '1')
      return out
    }
    return response ?? new Response('Site temporariamente indisponível.', { status: 503 })
  },
}
