#!/usr/bin/env bash
set -euo pipefail

echo "🔍 Validando variáveis Salad Cloud..."

# Defaults de produção (valores reais, não mocks)
SALAD_API_URL_DEFAULT="https://api.salad.com/api/public"
SALAD_MEDIA_PROJECT_DEFAULT="alice-media"
SALAD_GPU_CLASS_DEFAULT="premium-gpu"

# Aplicar valores com logging de auditoria
if [ -n "${SALAD_API_URL_CONFIGURED:-}" ]; then
  SALAD_API_URL_VAR="${SALAD_API_URL_CONFIGURED}"
  echo "✅ SALAD_API_URL: usando valor configurado no repositório"
else
  SALAD_API_URL_VAR="${SALAD_API_URL_DEFAULT}"
  echo "::warning::SALAD_API_URL não configurado - usando default: ${SALAD_API_URL_DEFAULT}"
fi

if [ -n "${SALAD_MEDIA_PROJECT_CONFIGURED:-}" ]; then
  SALAD_MEDIA_PROJECT_VAR="${SALAD_MEDIA_PROJECT_CONFIGURED}"
  echo "✅ SALAD_MEDIA_PROJECT: usando valor configurado no repositório"
else
  SALAD_MEDIA_PROJECT_VAR="${SALAD_MEDIA_PROJECT_DEFAULT}"
  echo "::warning::SALAD_MEDIA_PROJECT não configurado - usando default: ${SALAD_MEDIA_PROJECT_DEFAULT}"
fi

if [ -n "${SALAD_GPU_CLASS_CONFIGURED:-}" ]; then
  SALAD_GPU_CLASS_VAR="${SALAD_GPU_CLASS_CONFIGURED}"
  echo "✅ SALAD_GPU_CLASS: usando valor configurado no repositório"
else
  SALAD_GPU_CLASS_VAR="${SALAD_GPU_CLASS_DEFAULT}"
  echo "::warning::SALAD_GPU_CLASS não configurado - usando default: ${SALAD_GPU_CLASS_DEFAULT}"
fi

echo "📋 Resumo Salad Cloud:"
echo "   API URL: ${SALAD_API_URL_VAR}"
echo "   Project: ${SALAD_MEDIA_PROJECT_VAR}"
echo "   GPU Class: ${SALAD_GPU_CLASS_VAR}"
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
  RESEND_API_KEY_SECRET
  SALAD_API_KEY_SECRET
  SALAD_ORGANIZATION_ID_SECRET
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



