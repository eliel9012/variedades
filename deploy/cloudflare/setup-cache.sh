#!/usr/bin/env bash
# Liga Brotli + Always Online + 3 Page Rules de cache na zona do Cloudflare.
# NUNCA rode isto com credencial colada direto no comando nem commitada aqui.
#
# Aceita dois jeitos de autenticar (defina só um dos dois conjuntos):
#
#   1) API Token escopado (recomendado, acesso só a essa zona):
#      CLOUDFLARE_API_TOKEN="seu-token" CLOUDFLARE_ZONE_ID="seu-zone-id" \
#        SITE_DOMAIN="eleicoes.meulab.fun" bash deploy/cloudflare/setup-cache.sh
#
#   2) Global API Key (acesso total à conta, menos recomendado):
#      CLOUDFLARE_API_EMAIL="seu-email@dominio.com" CLOUDFLARE_API_KEY="sua-global-key" \
#        CLOUDFLARE_ZONE_ID="seu-zone-id" SITE_DOMAIN="eleicoes.meulab.fun" \
#        bash deploy/cloudflare/setup-cache.sh
#
# Onde achar:
# - Zone ID: dashboard > clica no domínio RAIZ (ex. meulab.fun, não um subdomínio)
#   > barra direita, caixa "API" > Zone ID.
# - API Token: dashboard > ícone de usuário > "My Profile" > "API Tokens" > "Create Token"
#   (Custom Token) com permissão de zona: Zone Settings (Edit), Page Rules (Edit),
#   Zone Resources escopado só a essa zona.
# - Global API Key: mesma tela "API Tokens", seção debaixo "Global API Key" > "View".
set -euo pipefail

: "${CLOUDFLARE_ZONE_ID:?defina CLOUDFLARE_ZONE_ID}"
: "${SITE_DOMAIN:?defina SITE_DOMAIN, ex.: eleicoes.meulab.fun}"

API="https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}"

if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  AUTH=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")
elif [[ -n "${CLOUDFLARE_API_EMAIL:-}" && -n "${CLOUDFLARE_API_KEY:-}" ]]; then
  AUTH=(-H "X-Auth-Email: ${CLOUDFLARE_API_EMAIL}" -H "X-Auth-Key: ${CLOUDFLARE_API_KEY}" -H "Content-Type: application/json")
else
  echo "Defina CLOUDFLARE_API_TOKEN, ou CLOUDFLARE_API_EMAIL + CLOUDFLARE_API_KEY (Global Key)." >&2
  exit 1
fi

echo "== Brotli =="
curl -s -X PATCH "${API}/settings/brotli" "${AUTH[@]}" --data '{"value":"on"}' | python3 -m json.tool

echo "== Always Online =="
curl -s -X PATCH "${API}/settings/always_online" "${AUTH[@]}" --data '{"value":"on"}' | python3 -m json.tool

echo "== Page Rule: /api/* -> bypass cache (nunca cachear rota dinâmica/autenticada) =="
curl -s -X POST "${API}/pagerules" "${AUTH[@]}" --data "$(cat <<JSON
{
  "targets": [{"target": "url", "constraint": {"operator": "matches", "value": "${SITE_DOMAIN}/api/*"}}],
  "actions": [{"id": "cache_level", "value": "bypass"}],
  "priority": 1,
  "status": "active"
}
JSON
)" | python3 -m json.tool

echo "== Page Rule: /assets/* -> cache 1 dia (arquivo já tem hash no nome) =="
curl -s -X POST "${API}/pagerules" "${AUTH[@]}" --data "$(cat <<JSON
{
  "targets": [{"target": "url", "constraint": {"operator": "matches", "value": "${SITE_DOMAIN}/assets/*"}}],
  "actions": [
    {"id": "cache_level", "value": "cache_everything"},
    {"id": "edge_cache_ttl", "value": 86400}
  ],
  "priority": 2,
  "status": "active"
}
JSON
)" | python3 -m json.tool

echo "== Page Rule: /data/* -> cache 10 min (json re-sincroniza periodicamente) =="
curl -s -X POST "${API}/pagerules" "${AUTH[@]}" --data "$(cat <<JSON
{
  "targets": [{"target": "url", "constraint": {"operator": "matches", "value": "${SITE_DOMAIN}/data/*"}}],
  "actions": [
    {"id": "cache_level", "value": "cache_everything"},
    {"id": "edge_cache_ttl", "value": 600}
  ],
  "priority": 3,
  "status": "active"
}
JSON
)" | python3 -m json.tool

echo "Pronto. Confira em dashboard > seu domínio > Regras > Page Rules."
