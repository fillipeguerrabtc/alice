#!/usr/bin/env bash
set -euo pipefail

echo "🔍 Validando secrets obrigatórias..."

# GPU Services (Hetzner GPU Server)
# Todos os serviços GPU rodam localmente no servidor Hetzner GPU único
# e são gerenciados pelo GPU Manager Service
echo "📋 GPU Services:"
echo "   Arquitetura: Servidor único Hetzner GPU GEX44 (RTX 4000 SFF Ada 20GB)"
echo "   Gerenciamento: GPU Manager Service (fila priorizada, VRAM monitoring)"
echo ""

echo "🔐 Validando secrets obrigatórias..."

require_secret() {
  local var_name="$1"
  local value="${!var_name:-}"
  if [ -z "$value" ]; then
    echo "::error::Secret obrigatória ausente: $var_name"
    exit 1
  fi
}

MANDATORY_SECRETS=(
  POSTGRES_PASSWORD_SECRET
  CLICKHOUSE_PASSWORD_SECRET
  CLICKHOUSE_USER_SECRET_VAL
  REDIS_CACHE_PASSWORD_SECRET
  REDIS_QUEUE_PASSWORD_SECRET
  ERPNEXT_MYSQL_ROOT_PASSWORD_SECRET
  ERPNEXT_DB_PASSWORD_SECRET
  GMAIL_USER_SECRET
  GMAIL_APP_PASSWORD_SECRET
  SESSION_SECRET_SECRET
  INTERNAL_API_SECRET_SECRET
  SEARXNG_SECRET_KEY_SECRET
  QDRANT_API_KEY_SECRET
  LANGFUSE_DB_USER_SECRET
  LANGFUSE_DB_PASSWORD_SECRET
  LANGFUSE_DB_NAME_SECRET
  GRAFANA_ADMIN_USER_SECRET
  GRAFANA_ADMIN_PASSWORD_SECRET
  ERPNEXT_ADMIN_PASSWORD_SECRET
  STRIPE_WEBHOOK_BASE_URL_SECRET
  WISE_WEBHOOK_SECRET_SECRET
  WISE_SANDBOX_SECRET
  ERPNEXT_API_KEY_SECRET
  ERPNEXT_API_SECRET_SECRET
  CORS_ORIGIN_SECRET
  CORS_ORIGINS_SECRET
)

for secret_var in "${MANDATORY_SECRETS[@]}"; do
  require_secret "$secret_var"
done

echo "✅ Todas as secrets obrigatórias estão presentes."



