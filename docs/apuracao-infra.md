# Infra da noite de apuração

- `apura-brasil.service`: `server/web.mjs` (Node, 4 workers) serve `dist/` em memória (br/gzip), `/data` ao vivo de `public/data`, `/tse/*` do espelho e repassa `/api/*` ao backend de Cenários (8790). Escuta em 0.0.0.0:8776 (o cloudflared aponta para 10.99.0.2:8776).
- `apura-brasil-ingest.service`: `scripts/ingest-tse.mjs` espelha os arquivos oficiais do TSE em `tse-mirror/oficial/...` (mesmos caminhos do TSE), com requisição condicional, prioridades (Presidente/Governador/Senador 15s, Deputados 60s, seções 30s), backoff e rodízio de upstreams. Estado em `/tse/status.json`.
- Upstreams em `/etc/apura-ingest.env` (`TSE_UPSTREAMS`): TSE direto e o Worker `frosty-block-6b20` (`deploy/cloudflare-worker-tse.js`), usado só quando o TSE responde 403/429/5xx ou cai.
- Front (`src/tse-results.ts`): lê o espelho se `status.json` teve sucesso nos últimos 2 min; senão, ou se o espelho falhar, vai direto ao TSE; por último, `latest.json` local.
- Cloudflare: Cache Rule "eleicoes - espelho TSE, dados e assets" respeita o Cache-Control da origem (`/tse/*` s-maxage=10 + stale-if-error, `/data/*` 60s, `/assets/*` imutável).
- Segundo domínio `eleicoesphvox.com.br` (zona própria no Cloudflare): mesmo túnel e origem (8776), mesmas rotas do Worker de fallback, mesma Cache Rule; `www` redireciona 301 para o domínio sem www. O `server/web.mjs` troca og:url/og:image/twitter:image pelo domínio acessado (o Worker de fallback guarda uma cópia por domínio); o canonical continua em `eleicoes.meulab.fun`. `scripts/purge-cf.sh` limpa os dois.
- Worker de fallback só nas páginas: rotas sem script excluem `/assets/*`, `/data/*`, `/icons/*`, `/.well-known/*`, `/og-image*`, logos, manifest, favicon, apple-touch-icon, robots, ads.txt e sitemap, nos dois domínios (além de `/api/*`, `/tse/*`, `/sw.js`, `/healthz`). Com tudo passando pelo Worker, a véspera já projetava ~270 mil execuções/dia contra a cota de 100 mil do plano Free (a cota zera às 00:00 UTC, 21h de Brasília). Estáticos e `/data` seguem no cache do Cloudflare com stale-if-error.
- Depois de mudar o front: `npm run deploy` (build + restart; o dist fica em memória).
- `apura-brasil-watchdog.service`: `scripts/watchdog.mjs` avisa no Telegram (@atualiza1bot, credenciais em `/etc/apura-telegram.env`) quando o espelho para, o TSE bloqueia, o site ou a IA caem, e quando voltam; manda o progresso de Presidente em marcos de seções apuradas.
- Mapa ao vivo: o ingest grava `/tse/resumo-presidente.json` (mais votado por UF, dos arquivos oficiais).
- Aviso do dia da eleição: automático em 04/10 e 25/10 (votação 8h-17h, apuração depois). Para conferir antes: `?simular=votacao` ou `?simular=apuracao`.
- Congelamento: depois do ensaio de sábado, nenhum deploy até o fim da apuração.
