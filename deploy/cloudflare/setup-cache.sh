#!/usr/bin/env bash
# Liga Brotli + Always Online + 3 Page Rules de cache na zona do Cloudflare.
# NUNCA rode isto com o token colado direto no comando nem commitado aqui.
# Rode assim (substitua pelos seus valores reais na hora):
#
#   CLOUDFLARE_API_TOKEN="seu-token" CLOUDFLARE_ZONE_ID="seu-zone-id" \
#     SITE_DOMAIN="eleicoes.meulab.fun" bash deploy/cloudflare/setup-cache.sh
#
# Onde achar:
# - Zone ID: dashboard do Cloudflare > seu domínio > barra direita, "API" > Zone ID.
# - Token: dashboard > ícone de usuário > "My Profile" > "API Tokens" > "Create Token"
#   com permissão de zona: Zone Settings (Edit), Page Rules (Edit), Cache Purge (Purge),
#   escopado só a essa zona.
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?defina CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ZONE_ID:?defina CLOUDFLARE_ZONE_ID}"
: "${SITE_DOMAIN:?defina SITE_DOMAIN, ex.: eleicoes.meulab.fun}"

API="https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}"
AUTH=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")

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
