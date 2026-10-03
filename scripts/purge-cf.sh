#!/usr/bin/env bash
# Limpa o cache do Cloudflare para o site (rodado pelo npm run deploy), nos
# dois domínios. Credenciais em /etc/apura-cloudflare.env, nunca no repositório.
set -uo pipefail
set -a; . /etc/apura-cloudflare.env; set +a
purge() { # zona, host
  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$1/purge_cache" \
    -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CF_GLOBAL_KEY" -H "content-type: application/json" \
    -d "{\"hosts\":[\"$2\"]}" | python3 -c "import json,sys;d=json.load(sys.stdin);print('purge cloudflare $2:', d['success'], d.get('errors') or '')"
}
purge ebafbceb5917021f98c92978eecca330 eleicoes.meulab.fun
purge 54b7f90982b02914c7f6b1f552a53b69 eleicoesphvox.com.br
