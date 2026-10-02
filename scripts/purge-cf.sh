#!/usr/bin/env bash
# Limpa o cache do Cloudflare para o site (rodado pelo npm run deploy).
# Credenciais em /etc/apura-cloudflare.env, nunca no repositório.
set -euo pipefail
set -a; . /etc/apura-cloudflare.env; set +a
ZONE=ebafbceb5917021f98c92978eecca330
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/purge_cache" \
  -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CF_GLOBAL_KEY" -H "content-type: application/json" \
  -d '{"hosts":["eleicoes.meulab.fun"]}' | python3 -c "import json,sys;d=json.load(sys.stdin);print('purge cloudflare:', d['success'], d.get('errors') or '')"
