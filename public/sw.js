const CACHE = 'apura-brasil-v4'
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/data/candidates.json', '/data/manifest.json']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  // /api/* é a rota dinâmica e autenticada do Cenários (IA): nunca cachear
  // nem servir por fora da rede, e nunca interceptar aqui, porque um fetch
  // mediado pelo Service Worker não dispara o pop-up nativo de usuário/senha
  // do navegador quando o servidor responde 401. Deixa passar direto.
  if (new URL(event.request.url).pathname.startsWith('/api/')) return
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    const copy = response.clone()
    caches.open(CACHE).then((cache) => cache.put(event.request, copy))
    return response
  }).catch(() => caches.match('/index.html'))))
})
