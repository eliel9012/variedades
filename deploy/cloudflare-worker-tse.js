// Worker do Cloudflare: saída secundária para o ingest buscar os arquivos do
// TSE a partir dos IPs do Cloudflare (não do IP desta máquina), caso o CDN do
// TSE limite/bloqueie o servidor na noite da apuração.
//
// Como usar: Cloudflare > Workers & Pages > Create > "Hello World", cole este
// arquivo, Deploy. Depois, nesta máquina, em /etc/apura-ingest.env:
//   TSE_UPSTREAMS=https://resultados.tse.jus.br,https://<seu-worker>.workers.dev
// e `systemctl restart apura-brasil-ingest`. O ingest usa o TSE direto e só
// passa a usar o Worker quando o TSE responder 403/429/5xx ou cair.
//
// Só repassa GET de /oficial/* (os arquivos públicos de resultado); qualquer
// outra coisa devolve 404. Não altera o conteúdo.

const UPSTREAM = 'https://resultados.tse.jus.br'

export default {
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method !== 'GET' || !url.pathname.startsWith('/oficial/')) {
      return new Response('Não encontrado', { status: 404 })
    }
    const headers = new Headers()
    for (const name of ['if-none-match', 'if-modified-since', 'accept']) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    headers.set('user-agent', 'ApuraBrasil-ingest/1.0 (via Cloudflare Worker)')
    const response = await fetch(`${UPSTREAM}${url.pathname}`, {
      headers,
      // Cache curto na borda do Cloudflare: segura repetição sem atrasar a apuração.
      cf: { cacheTtlByStatus: { '200-299': 5, '404': 30, '500-599': 0 } },
    })
    const out = new Response(response.body, response)
    out.headers.set('cache-control', 'no-store')
    return out
  },
}
