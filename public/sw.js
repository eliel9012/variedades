const CACHE = 'apura-brasil-v5'
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/data/candidates.json', '/data/manifest.json']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()))
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
  if (event.request.method !== 'GET') return
  // /api/* é a rota dinâmica e autenticada do Cenários (IA): nunca cachear
  // nem servir por fora da rede, e nunca interceptar aqui, porque um fetch
  // mediado pelo Service Worker não dispara o pop-up nativo de usuário/senha
  // do navegador quando o servidor responde 401. Deixa passar direto.
  if (new URL(event.request.url).pathname.startsWith('/api/')) return
  // Network-first, não cache-first: o site muda de código com frequência (sem
  // build versionado por hash), então tentar a rede primeiro garante que quem
  // está online sempre vê a versão mais nova. O cache (escopado só a essa
  // versão, `{ cacheName: CACHE }`) é só a rede de segurança pra quando a
  // pessoa está offline de verdade.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone()
        caches.open(CACHE).then((cache) => cache.put(event.request, copy))
        return response
      })
      .catch(() =>
        caches
          .match(event.request, { cacheName: CACHE })
          .then((cached) => cached || caches.match('/index.html', { cacheName: CACHE })),
      ),
  )
})
