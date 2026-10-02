# Infra da noite de apuração

- `apura-brasil.service`: `server/web.mjs` (Node, 4 workers) serve `dist/` em memória (br/gzip), `/data` ao vivo de `public/data`, `/tse/*` do espelho e repassa `/api/*` ao backend de Cenários (8790). Escuta em 0.0.0.0:8776 (o cloudflared aponta para 10.99.0.2:8776).
- `apura-brasil-ingest.service`: `scripts/ingest-tse.mjs` espelha os arquivos oficiais do TSE em `tse-mirror/oficial/...` (mesmos caminhos do TSE), com requisição condicional, prioridades (Presidente/Governador/Senador 15s, Deputados 60s, seções 30s), backoff e rodízio de upstreams. Estado em `/tse/status.json`.
- Upstreams em `/etc/apura-ingest.env` (`TSE_UPSTREAMS`): TSE direto e o Worker `frosty-block-6b20` (`deploy/cloudflare-worker-tse.js`), usado só quando o TSE responde 403/429/5xx ou cai.
- Front (`src/tse-results.ts`): lê o espelho se `status.json` teve sucesso nos últimos 2 min; senão, ou se o espelho falhar, vai direto ao TSE; por último, `latest.json` local.
- Cloudflare: Cache Rule "eleicoes - espelho TSE, dados e assets" respeita o Cache-Control da origem (`/tse/*` s-maxage=10 + stale-if-error, `/data/*` 60s, `/assets/*` imutável).
- Depois de mudar o front: `npm run deploy` (build + restart; o dist fica em memória).
