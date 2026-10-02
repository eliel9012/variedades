const CACHE = 'apura-brasil-v6'
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/data/candidates.json', '/data/manifest.json']

// O build do Vite gera /assets/index-<hash>.js/.css: sem eles no cache, o
// index.html offline abre em branco. Lê o index.html recém-baixado e
// pré-cacheia todo <script src> e <link href> que aponte pra /assets/.
async function precacheBuiltAssets(cache) {
  const response = await fetch('/', { cache: 'no-store' })
  if (!response.ok) return
  const html = await response.text()
  const assets = new Set()
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)) {
    const url = new URL(match[1], location.origin)
    if (url.origin === location.origin && url.pathname.startsWith('/assets/')) assets.add(url.pathname)
  }
  if (assets.size) await cache.addAll([...assets])
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE).then(() => precacheBuiltAssets(cache).catch(() => undefined)))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  // v4 e anteriores eram cache-first (`caches.match` sem nome de cache
  // específico, que procura em TODAS as caches da origem): depois que algo
  // era cacheado uma vez, ficava servindo pra sempre, mesmo trocando o nome
  // de CACHE aqui, porque o cache antigo nunca era apagado e continuava
  // "achável". Isso fazia quem já tinha visitado o site nunca ver deploy
  // nenhum sem limpar dados do site na mão. Apaga qualquer cache de versão
  // anterior aqui pra isso nunca mais acontecer.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Outras origens (TSE, Google Fonts, anúncios): não intercepta nem cacheia.
  // O TSE em especial precisa sempre ir direto à rede (`cache: 'no-store'`).
  if (url.origin !== location.origin) return
  // /api/* é a rota dinâmica e autenticada do Cenários (IA): nunca cachear
  // nem servir por fora da rede, e nunca interceptar aqui, porque um fetch
  // mediado pelo Service Worker não dispara o pop-up nativo de usuário/senha
  // do navegador quando o servidor responde 401. Deixa passar direto.
  if (url.pathname.startsWith('/api/')) return
  // Network-first, não cache-first: o site muda de código com frequência, então
  // tentar a rede primeiro garante que quem está online sempre vê a versão mais
  // nova. O cache (escopado só a essa versão, `{ cacheName: CACHE }`) é só a
  // rede de segurança pra quando a pessoa está offline de verdade.
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Só guarda respostas completas e bem-sucedidas: nada de 404/500,
        // 206 (parcial) ou opacas sobrescrevendo uma cópia boa do cache.
        if (response.ok && response.status === 200 && request.method === 'GET') {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(() =>
        caches.match(request, { cacheName: CACHE }).then((cached) => {
          if (cached) return cached
          // index.html só faz sentido como fallback de navegação (SPA); para
          // JSON/JS/imagens devolver HTML quebraria o parser do chamador.
          if (request.mode === 'navigate') return caches.match('/index.html', { cacheName: CACHE })
          return Response.error()
        }),
      ),
  )
})
