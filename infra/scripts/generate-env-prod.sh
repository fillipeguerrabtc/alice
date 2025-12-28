#!/bin/bash
# =============================================================================
# Script: generate-env-prod.sh
# Descrição: Gera arquivo .env.prod para deploy em produção
# Autor: Fillipe Guerra
# Data: 21/12/2025
# =============================================================================
# REGRA 6 (CLAUDE.md): Enterprise-grade - sem mocks, sem hardcoded, persistência real
# REGRA 8: Qualidade obrigatória - validação de todas as secrets obrigatórias
# REGRA 14: Verificação de secrets existentes
#
# Uso: Este script é chamado pelo workflow deploy-production.yml
# Todas as variáveis são passadas via environment variables
# =============================================================================

set -euo pipefail

echo "=============================================="
echo "GERANDO .env.prod PARA PRODUÇÃO"
echo "=============================================="

# =============================================================================
# FASE 1: GPU Services (Hetzner GPU Server)
# =============================================================================
echo "🔍 Configurando GPU Services (Hetzner GPU Server)..."

# =============================================================================
# GPU SERVICES - Arquitetura Single Server (25/12/2025)
# =============================================================================
# Todos os serviços GPU rodam localmente no servidor Hetzner GPU único
# e são gerenciados pelo GPU Manager Service com fila priorizada,
# monitoramento VRAM e circuit breakers.
# Documentação: docs/ARQUITETURA-GPU-MANAGER.md
# =============================================================================

# GPU Services (Hetzner GPU Server)
# Todos os serviços GPU rodam localmente no servidor Hetzner GPU único
# e são gerenciados pelo GPU Manager Service
echo "📋 GPU Services:"
echo "   Arquitetura: Servidor único Hetzner GPU GEX44 (RTX 4000 SFF Ada 20GB)"
echo "   Gerenciamento: GPU Manager Service (fila priorizada, VRAM monitoring)"
echo ""

# =============================================================================
# FASE 2: Validação das secrets obrigatórias (fail-fast)
# =============================================================================
echo "🔐 Validando secrets obrigatórias..."

POSTGRES_PASSWORD="${POSTGRES_PASSWORD_SECRET:-}"
if [ -z "${POSTGRES_PASSWORD}" ]; then
  echo "::error::POSTGRES_PASSWORD não definido. Configure o secret POSTGRES_PASSWORD no repositório." >&2
  exit 1
fi

# CORREÇÃO 23/12/2025: Validação restritiva REMOVIDA - URL-encoding no workflow suporta qualquer senha
# Antes: Validação rejeitava senhas com caracteres especiais (+/=@:?#%), forçando apenas hex
# Agora: Workflow usa função urlencode() (RFC 3986 compliant) que suporta qualquer caractere
# Isso permite senhas mais complexas e seguras, mantendo compatibilidade com DATABASE_URL
# NOTA: openssl rand -hex 32 ainda é recomendado para senhas URL-safe, mas não é mais obrigatório

REDIS_PASSWORD="${REDIS_PASSWORD_SECRET:-}"
if [ -z "${REDIS_PASSWORD}" ]; then
  echo "::error::REDIS_PASSWORD não definido. Configure o secret REDIS_PASSWORD no repositório." >&2
  exit 1
fi

# CORREÇÃO 22/12/2025: Validar que senha Redis não contém caracteres especiais de URL
# Senhas com +, /, =, @, :, ?, #, % quebram URLs Redis (ex: redis://:senha@host:port)
# Use: openssl rand -hex 32 (hexadecimal é 100% URL-safe)
if echo "${REDIS_PASSWORD}" | grep -qE '[+/=@:?#%]'; then
  echo "::error::REDIS_PASSWORD contém caracteres especiais de URL (+/=@:?#%). URLs Redis serão malformadas. Regenere com: openssl rand -hex 32" >&2
  exit 1
fi

ADMIN_USER="${ADMIN_USER_SECRET:-}"
ADMIN_PWD="${ADMIN_PWD_SECRET:-}"
if [ -z "${ADMIN_USER}" ] || [ -z "${ADMIN_PWD}" ]; then
  echo "::error::ADMIN_USER/ADMIN_PWD não definidos. Configure os secrets ADMIN_USER e ADMIN_PWD para o administrador global." >&2
  exit 1
fi

QDRANT_API_KEY="${QDRANT_API_KEY_SECRET:-}"
if [ -z "${QDRANT_API_KEY}" ]; then
  echo "::error::QDRANT_API_KEY não definido. Configure o secret QDRANT_API_KEY no repositório (necessário para alice-qdrant)." >&2
  exit 1
fi

SESSION_SECRET="${SESSION_SECRET_SECRET:-}"
if [ -z "${SESSION_SECRET}" ]; then
  echo "::error::SESSION_SECRET não definido. Configure o secret SESSION_SECRET no repositório (necessário para auth-service)." >&2
  exit 1
fi

INTERNAL_API_SECRET="${INTERNAL_API_SECRET_SECRET:-}"
if [ -z "${INTERNAL_API_SECRET}" ]; then
  echo "::error::INTERNAL_API_SECRET não definido. Configure o secret INTERNAL_API_SECRET no repositório (necessário para comunicação entre serviços)." >&2
  exit 1
fi

SEARXNG_SECRET_KEY="${SEARXNG_SECRET_KEY_SECRET:-}"
if [ -z "${SEARXNG_SECRET_KEY}" ]; then
  echo "::error::SEARXNG_SECRET_KEY não definido. Configure o secret SEARXNG_SECRET_KEY no repositório (necessário para alice-searxng)." >&2
  exit 1
fi

CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD_SECRET:-}"
if [ -z "${CLICKHOUSE_PASSWORD}" ]; then
  echo "::error::CLICKHOUSE_PASSWORD não definido. Configure o secret CLICKHOUSE_PASSWORD no repositório (necessário para clickhouse)." >&2
  exit 1
fi

REDIS_CACHE_PASSWORD="${REDIS_CACHE_PASSWORD_SECRET:-}"
if [ -z "${REDIS_CACHE_PASSWORD}" ]; then
  echo "::error::REDIS_CACHE_PASSWORD não definido. Configure o secret REDIS_CACHE_PASSWORD no repositório (necessário para ERPNext redis-cache)." >&2
  exit 1
fi

# CORREÇÃO 22/12/2025: Validar que senha Redis não contém caracteres especiais de URL
# Senhas com +, /, =, @, :, ?, #, % quebram URLs Redis (ex: redis://:senha@host:port)
# Use: openssl rand -hex 32 (hexadecimal é 100% URL-safe)
if echo "${REDIS_CACHE_PASSWORD}" | grep -qE '[+/=@:?#%]'; then
  echo "::error::REDIS_CACHE_PASSWORD contém caracteres especiais de URL (+/=@:?#%). URLs Redis serão malformadas. Regenere com: openssl rand -hex 32" >&2
  exit 1
fi

REDIS_QUEUE_PASSWORD="${REDIS_QUEUE_PASSWORD_SECRET:-}"
if [ -z "${REDIS_QUEUE_PASSWORD}" ]; then
  echo "::error::REDIS_QUEUE_PASSWORD não definido. Configure o secret REDIS_QUEUE_PASSWORD no repositório (necessário para ERPNext redis-queue)." >&2
  exit 1
fi

# CORREÇÃO 22/12/2025: Validar que senha Redis não contém caracteres especiais de URL
if echo "${REDIS_QUEUE_PASSWORD}" | grep -qE '[+/=@:?#%]'; then
  echo "::error::REDIS_QUEUE_PASSWORD contém caracteres especiais de URL (+/=@:?#%). URLs Redis serão malformadas. Regenere com: openssl rand -hex 32" >&2
  exit 1
fi

ERPNEXT_MYSQL_ROOT_PASSWORD="${ERPNEXT_MYSQL_ROOT_PASSWORD_SECRET:-}"
if [ -z "${ERPNEXT_MYSQL_ROOT_PASSWORD}" ]; then
  echo "::error::ERPNEXT_MYSQL_ROOT_PASSWORD não definido. Configure o secret ERPNEXT_MYSQL_ROOT_PASSWORD no repositório (necessário para mariadb)." >&2
  exit 1
fi

ERPNEXT_DB_PASSWORD="${ERPNEXT_DB_PASSWORD_SECRET:-}"
if [ -z "${ERPNEXT_DB_PASSWORD}" ]; then
  echo "::error::ERPNEXT_DB_PASSWORD não definido. Configure o secret ERPNEXT_DB_PASSWORD no repositório (necessário para mariadb)." >&2
  exit 1
fi

# =============================================================================
# VALIDAÇÃO GPU SERVICES (Hetzner GPU Server - 25/12/2025)
# =============================================================================
# Todos os serviços GPU rodam localmente no servidor Hetzner GPU único
# e são gerenciados pelo GPU Manager Service
# HUGGINGFACE_TOKEN é obrigatório para download de modelos
# =============================================================================
echo ""
echo "🔐 Validando GPU Services (Hetzner GPU Server)..."

HUGGINGFACE_TOKEN="${HUGGINGFACE_TOKEN:-}"
if [ -z "${HUGGINGFACE_TOKEN}" ]; then
  echo "::error::HUGGINGFACE_TOKEN não definido. Configure o secret HUGGINGFACE_TOKEN no repositório (obrigatório para download de modelos GPU em produção)." >&2
  exit 1
fi

echo "✅ GPU Services validados (Hetzner GPU Server)"
echo "✅ Todas as secrets obrigatórias validadas"

# =============================================================================
# FASE 3: Validação de formato e comprimento
# =============================================================================
echo "📝 Validando formato de ADMIN_USER e ADMIN_PWD..."

if ! echo "${ADMIN_USER}" | grep -qE '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'; then
  echo "::error::ADMIN_USER deve ser um email válido (formato: user@example.com). Valor fornecido: ${ADMIN_USER}" >&2
  exit 1
fi

if [ ${#ADMIN_PWD} -lt 8 ]; then
  echo "::error::ADMIN_PWD deve ter no mínimo 8 caracteres. Comprimento atual: ${#ADMIN_PWD}" >&2
  exit 1
fi

# =============================================================================
# FASE 4: Fallback seguro para secrets opcionais
# =============================================================================
echo "🔄 Configurando fallbacks para secrets opcionais..."

if [ -z "${GRAFANA_ADMIN_USER_SECRET:-}" ]; then
  GRAFANA_ADMIN_USER="${ADMIN_USER}"
else
  GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER_SECRET}"
fi

if [ -z "${GRAFANA_ADMIN_PASSWORD_SECRET:-}" ]; then
  GRAFANA_ADMIN_PASSWORD="${ADMIN_PWD}"
else
  GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD_SECRET}"
fi

if [ -z "${ERPNEXT_ADMIN_PASSWORD_SECRET:-}" ]; then
  ERPNEXT_ADMIN_PASSWORD="${ADMIN_PWD}"
else
  ERPNEXT_ADMIN_PASSWORD="${ERPNEXT_ADMIN_PASSWORD_SECRET}"
fi

if [ -z "${STRIPE_WEBHOOK_BASE_URL_SECRET:-}" ]; then
  STRIPE_WEBHOOK_BASE_URL="https://yesyoudeserve.duckdns.org"
else
  STRIPE_WEBHOOK_BASE_URL="${STRIPE_WEBHOOK_BASE_URL_SECRET}"
fi

if [ -z "${WISE_WEBHOOK_SECRET_SECRET:-}" ]; then
  WISE_WEBHOOK_SECRET=""
else
  WISE_WEBHOOK_SECRET="${WISE_WEBHOOK_SECRET_SECRET}"
fi

if [ -z "${WISE_SANDBOX_SECRET:-}" ]; then
  WISE_SANDBOX="false"
else
  WISE_SANDBOX="${WISE_SANDBOX_SECRET}"
fi

if [ -z "${ERPNEXT_API_KEY_SECRET:-}" ]; then
  ERPNEXT_API_KEY=""
else
  ERPNEXT_API_KEY="${ERPNEXT_API_KEY_SECRET}"
fi

if [ -z "${ERPNEXT_API_SECRET_SECRET:-}" ]; then
  ERPNEXT_API_SECRET=""
else
  ERPNEXT_API_SECRET="${ERPNEXT_API_SECRET_SECRET}"
fi

# =============================================================================
# FASE 5: Validação Langfuse DB
# =============================================================================
LANGFUSE_DB_USER="${LANGFUSE_DB_USER_SECRET:-}"
LANGFUSE_DB_PASSWORD="${LANGFUSE_DB_PASSWORD_SECRET:-}"
LANGFUSE_DB_NAME="${LANGFUSE_DB_NAME_SECRET:-}"

if [ -z "${LANGFUSE_DB_USER}" ] || [ -z "${LANGFUSE_DB_PASSWORD}" ] || [ -z "${LANGFUSE_DB_NAME}" ]; then
  echo "::error::LANGFUSE_DB_USER/LANGFUSE_DB_PASSWORD/LANGFUSE_DB_NAME são obrigatórios para o langfuse-db. Configure os secrets correspondentes." >&2
  exit 1
fi

# Validar que senha não contém caracteres especiais de URL
if echo "${LANGFUSE_DB_PASSWORD}" | grep -qE '[][@:/?#%]'; then
  echo "::error::LANGFUSE_DB_PASSWORD contém caracteres especiais de URL (@:/?#%[]). Configure uma senha sem esses caracteres para evitar URL malformada." >&2
  exit 1
fi

# =============================================================================
# FASE 6: Validação CORS
# =============================================================================
CORS_ORIGIN_VALUE="$(printf '%s' "${CORS_ORIGIN_SECRET:-}" | xargs)"
CORS_ORIGINS_VALUE="$(printf '%s' "${CORS_ORIGINS_SECRET:-}" | xargs)"

# Normalizar lista
if [ -n "${CORS_ORIGINS_VALUE}" ]; then
  CORS_ORIGINS_VALUE="$(printf '%s' "${CORS_ORIGINS_VALUE}" | awk 'BEGIN{RS=",";ORS=","}{gsub(/^ +| +$/,""); if(length($0)>0) print $0}' | sed 's/,$//')"
fi

if [ -z "${CORS_ORIGIN_VALUE}" ] && [ -z "${CORS_ORIGINS_VALUE}" ]; then
  echo "::error::Defina ao menos um dos secrets CORS_ORIGIN ou CORS_ORIGINS para liberar o frontend. Ambos estão vazios." >&2
  exit 1
fi

if [ -z "${CORS_ORIGIN_VALUE}" ] && [ -n "${CORS_ORIGINS_VALUE}" ]; then
  CORS_ORIGIN_VALUE="$(printf '%s' "${CORS_ORIGINS_VALUE}" | cut -d',' -f1 | xargs)"
  if [ -z "${CORS_ORIGIN_VALUE}" ]; then
    echo "::error::CORS_ORIGINS contém apenas delimitadores ou espaços. Configure um valor válido (ex: https://yesyoudeserve.duckdns.org)." >&2
    exit 1
  fi
fi

if [ -z "${CORS_ORIGINS_VALUE}" ] && [ -n "${CORS_ORIGIN_VALUE}" ]; then
  CORS_ORIGINS_VALUE="${CORS_ORIGIN_VALUE}"
fi

# =============================================================================
# FASE 7: Configurar valores SMTP (Resend)
# =============================================================================
SMTP_HOST_VALUE="smtp.resend.com"
SMTP_PORT_VALUE="587"
SMTP_FROM_VALUE="onboarding@resend.dev"
SMTP_USERNAME_VALUE="resend"
ALERT_EMAIL_VALUE="ops@yesyoudeserve.duckdns.org"
CRITICAL_EMAIL_VALUE="critical@yesyoudeserve.duckdns.org"
ONCALL_EMAIL_VALUE="oncall@yesyoudeserve.duckdns.org"

# =============================================================================
# FASE 8: Gerar arquivo .env.prod
# =============================================================================
echo "📄 Gerando arquivo .env.prod..."

{
  printf '# ==============================================\n'
  printf '# ALICE PLATFORM - PRODUÇÃO\n'
  printf '# Gerado automaticamente pelo CI/CD\n'
  printf '# Commit: %s\n' "${GITHUB_SHA}"
  printf '# ==============================================\n'
  printf '\n'
  printf '# Imagens Docker\n'
  printf 'IMAGE_PREFIX=%s\n' "${IMAGE_PREFIX}"
  printf 'IMAGE_TAG=%s\n' "${IMAGE_TAG}"
  printf '\n'
  printf '# Versões Automáticas dos Componentes\n'
  printf 'PGBACKREST_VERSION=%s\n' "${PGBACKREST_VERSION}"
  printf 'TRAEFIK_VERSION=%s\n' "${TRAEFIK_VERSION}"
  printf 'PROMETHEUS_VERSION=%s\n' "${PROMETHEUS_VERSION}"
  printf 'GRAFANA_VERSION=%s\n' "${GRAFANA_VERSION}"
  printf 'LOKI_VERSION=%s\n' "${LOKI_VERSION}"
  printf 'PROMTAIL_VERSION=%s\n' "${PROMTAIL_VERSION}"
  printf 'JAEGER_VERSION=%s\n' "${JAEGER_VERSION}"
  printf 'LANGFUSE_VERSION=%s\n' "${LANGFUSE_VERSION}"
  printf 'ERPNEXT_VERSION=%s\n' "${ERPNEXT_VERSION}"
  printf 'DOCKER_SOCKET_PROXY_VERSION=%s\n' "${DOCKER_SOCKET_PROXY_VERSION}"
  printf 'BUSYBOX_VERSION=%s\n' "${BUSYBOX_VERSION}"
  printf 'REDIS_VERSION=%s\n' "${REDIS_VERSION}"
  printf 'MARIADB_VERSION=%s\n' "${MARIADB_VERSION}"
  printf 'PGVECTOR_TAG=%s\n' "${PGVECTOR_TAG}"
  printf '\n'
  printf '# PostgreSQL Alice\n'
  printf 'POSTGRES_USER=alice\n'
  printf 'POSTGRES_PASSWORD=%s\n' "${POSTGRES_PASSWORD}"
  printf 'POSTGRES_DB=alice_prod\n'
  printf '\n'
  printf '# Redis Alice\n'
  printf 'REDIS_PASSWORD=%s\n' "${REDIS_PASSWORD}"
  printf 'REDIS_URL=redis://:%s@alice-redis:6379/0\n' "${REDIS_PASSWORD}"
  printf '\n'
  printf '# Redis ERPNext\n'
  printf 'REDIS_CACHE_PASSWORD=%s\n' "${REDIS_CACHE_PASSWORD}"
  printf 'REDIS_QUEUE_PASSWORD=%s\n' "${REDIS_QUEUE_PASSWORD}"
  printf '\n'
  printf '# Sessão e Segurança S2S\n'
  printf 'SESSION_SECRET=%s\n' "${SESSION_SECRET}"
  printf 'INTERNAL_API_SECRET=%s\n' "${INTERNAL_API_SECRET}"
  printf '\n'
  printf '# OAuth Google\n'
  printf 'GOOGLE_CLIENT_ID=%s\n' "${GOOGLE_CLIENT_ID:-}"
  printf 'GOOGLE_CLIENT_SECRET=%s\n' "${GOOGLE_CLIENT_SECRET:-}"
  printf '\n'
  printf '# OAuth GitHub\n'
  printf 'OAUTH_GITHUB_CLIENT_ID=%s\n' "${OAUTH_GITHUB_CLIENT_ID:-}"
  printf 'OAUTH_GITHUB_CLIENT_SECRET=%s\n' "${OAUTH_GITHUB_CLIENT_SECRET:-}"
  printf '\n'
  printf '# GPU Services (Hetzner GPU Server)\n'
  printf 'HUGGINGFACE_TOKEN=%s\n' "${HUGGINGFACE_TOKEN:-}"
  # BUG FIX 25/12/2025: Container name correto é alice-gpu-manager (definido em docker-compose.prod.yml)
  printf 'GPU_MANAGER_URL=http://alice-gpu-manager:3010\n'
  printf '\n'
  printf '# Qdrant - Banco Vetorial para Texto\n'
  printf 'QDRANT_API_KEY=%s\n' "${QDRANT_API_KEY}"
  printf 'QDRANT_URL=http://alice-qdrant:6333\n'
  printf '\n'
  printf '# RAG Service\n'
  printf 'RAG_PUBLIC_BASE_URL=https://yesyoudeserve.duckdns.org\n'
  printf '\n'
  printf '# CORS\n'
  printf 'CORS_ORIGIN=%s\n' "${CORS_ORIGIN_VALUE}"
  printf 'CORS_ORIGINS=%s\n' "${CORS_ORIGINS_VALUE}"
  printf '\n'
  printf '# Alertmanager / Resend SMTP\n'
  printf 'SMTP_HOST=%s\n' "${SMTP_HOST_VALUE}"
  printf 'SMTP_PORT=%s\n' "${SMTP_PORT_VALUE}"
  printf 'SMTP_FROM=%s\n' "${SMTP_FROM_VALUE}"
  printf 'SMTP_USERNAME=%s\n' "${SMTP_USERNAME_VALUE}"
  printf 'SMTP_PASSWORD=%s\n' "${RESEND_API_KEY:-}"
  printf 'ALERT_EMAIL=%s\n' "${ALERT_EMAIL_VALUE}"
  printf 'CRITICAL_EMAIL=%s\n' "${CRITICAL_EMAIL_VALUE}"
  printf 'ONCALL_EMAIL=%s\n' "${ONCALL_EMAIL_VALUE}"
  printf '\n'
  printf '# Stripe Portugal\n'
  printf 'STRIPE_SECRET_KEY=%s\n' "${STRIPE_SECRET_KEY:-}"
  printf 'STRIPE_PUBLISHABLE_KEY=%s\n' "${STRIPE_PUBLISHABLE_KEY:-}"
  printf 'STRIPE_WEBHOOK_SECRET=%s\n' "${STRIPE_WEBHOOK_SECRET:-}"
  printf 'STRIPE_WEBHOOK_BASE_URL=%s\n' "${STRIPE_WEBHOOK_BASE_URL}"
  printf '\n'
  printf '# Twilio\n'
  printf 'TWILIO_ACCOUNT_SID=%s\n' "${TWILIO_ACCOUNT_SID:-}"
  printf 'TWILIO_AUTH_TOKEN=%s\n' "${TWILIO_AUTH_TOKEN:-}"
  printf 'TWILIO_WHATSAPP_NUMBER=%s\n' "${TWILIO_WHATSAPP_NUMBER:-}"
  printf '\n'
  printf '# Resend\n'
  printf 'RESEND_API_KEY=%s\n' "${RESEND_API_KEY:-}"
  printf '\n'
  printf '# Wise\n'
  printf 'WISE_API_KEY=%s\n' "${WISE_API_KEY:-}"
  printf 'WISE_PROFILE_ID=%s\n' "${WISE_PROFILE_ID:-}"
  printf 'WISE_WEBHOOK_SECRET=%s\n' "${WISE_WEBHOOK_SECRET}"
  printf 'WISE_SANDBOX=%s\n' "${WISE_SANDBOX}"
  printf '\n'
  printf '# KuCoin Futures\n'
  printf 'KUCOIN_PRO_API_KEY=%s\n' "${KUCOIN_PRO_API_KEY:-}"
  printf 'KUCOIN_PRO_API_SECRET=%s\n' "${KUCOIN_PRO_API_SECRET:-}"
  printf 'KUCOIN_PRO_API_PASSPHRASE=%s\n' "${KUCOIN_PRO_API_PASSPHRASE:-}"
  printf 'KUCOIN_PRO_BASE_URL=%s\n' "${KUCOIN_PRO_BASE_URL:-}"
  printf 'KUCOIN_SANDBOX_MODE=false\n'
  printf '\n'
  printf '# ERPNext Database\n'
  printf 'ERPNEXT_SITE_NAME=erp.yesyoudeserve.duckdns.org\n'
  printf 'ERPNEXT_MYSQL_ROOT_PASSWORD=%s\n' "${ERPNEXT_MYSQL_ROOT_PASSWORD}"
  printf 'ERPNEXT_ADMIN_PASSWORD=%s\n' "${ERPNEXT_ADMIN_PASSWORD}"
  printf 'ERPNEXT_DB_NAME=erpnext\n'
  printf 'ERPNEXT_DB_USER=erpnext\n'
  printf 'ERPNEXT_DB_PASSWORD=%s\n' "${ERPNEXT_DB_PASSWORD}"
  printf '\n'
  printf '# ERPNext API\n'
  printf 'ERPNEXT_URL=https://erp.yesyoudeserve.duckdns.org\n'
  printf 'ERPNEXT_API_KEY=%s\n' "${ERPNEXT_API_KEY}"
  printf 'ERPNEXT_API_SECRET=%s\n' "${ERPNEXT_API_SECRET}"
  printf '\n'
  printf '# Backup (pgBackRest)\n'
  printf 'BACKUP_CIPHER_PASS=%s\n' "${BACKUP_CIPHER_PASS:-}"
  printf '\n'
  printf '# SSL/TLS\n'
  printf 'ACME_EMAIL=%s\n' "${ACME_EMAIL:-}"
  printf '\n'
  printf '# Grafana\n'
  printf 'GRAFANA_ADMIN_USER=%s\n' "${GRAFANA_ADMIN_USER}"
  printf 'GRAFANA_ADMIN_PASSWORD=%s\n' "${GRAFANA_ADMIN_PASSWORD}"
  printf 'GF_SECURITY_ADMIN_USER=%s\n' "${GRAFANA_ADMIN_USER}"
  printf 'GF_SECURITY_ADMIN_PASSWORD=%s\n' "${GRAFANA_ADMIN_PASSWORD}"
  printf '\n'
  printf '# Admin centralizado\n'
  printf 'ADMIN_USER=%s\n' "${ADMIN_USER}"
  printf 'ADMIN_PWD=%s\n' "${ADMIN_PWD}"
  printf '\n'
  printf '# Langfuse\n'
  printf 'LANGFUSE_SECRET_KEY=%s\n' "${LANGFUSE_SECRET_KEY:-}"
  printf 'LANGFUSE_NEXT_AUTH_SECRET=%s\n' "${LANGFUSE_NEXT_AUTH_SECRET:-}"
  printf 'LANGFUSE_SALT=%s\n' "${LANGFUSE_SALT:-}"
  printf 'LANGFUSE_ENCRYPTION_KEY=%s\n' "${LANGFUSE_ENCRYPTION_KEY:-}"
  printf 'LANGFUSE_DB_USER=%s\n' "${LANGFUSE_DB_USER}"
  printf 'LANGFUSE_DB_PASSWORD=%s\n' "${LANGFUSE_DB_PASSWORD}"
  printf 'LANGFUSE_DB_NAME=%s\n' "${LANGFUSE_DB_NAME}"
  printf '\n'
  printf '# ClickHouse\n'
  CLICKHOUSE_USER_VALUE="${CLICKHOUSE_USER_SECRET_VAL:-langfuse}"
  printf 'CLICKHOUSE_USER=%s\n' "${CLICKHOUSE_USER_VALUE}"
  printf 'CLICKHOUSE_PASSWORD=%s\n' "${CLICKHOUSE_PASSWORD}"
  printf 'CLICKHOUSE_DB=%s\n' "${CLICKHOUSE_DB:-langfuse}"
  printf '\n'
  printf '# SearXNG\n'
  printf 'SEARXNG_SECRET_KEY=%s\n' "${SEARXNG_SECRET_KEY}"
} > .env.prod

chmod 600 .env.prod

# =============================================================================
# FASE 9: Validação pgbackrest.conf
# =============================================================================
EXPECTED_STANZA="${PGBACKREST_STANZA:-alice_prod}"
if ! grep -q "^\[${EXPECTED_STANZA}\]" infra/backup/pgbackrest.conf; then
  echo "::error::pgbackrest.conf não define a stanza '${EXPECTED_STANZA}'. Scripts de backup falharão em runtime." >&2
  exit 1
fi
echo "✅ Validação: pgbackrest.conf contém stanza '${EXPECTED_STANZA}'"

# =============================================================================
# FASE 10: Gerar arquivos de secret para volumes
# =============================================================================
echo "🔐 Gerando arquivos de secret..."

printf '%s' "${LANGFUSE_DB_PASSWORD}" > langfuse_db_password
chmod 600 langfuse_db_password

RESEND_API_KEY_VALUE="${RESEND_API_KEY:-}"
if [ -z "${RESEND_API_KEY_VALUE}" ]; then
  echo "::error::RESEND_API_KEY é obrigatório para alertmanager SMTP. Configure o secret no repositório." >&2
  exit 1
fi
printf '%s' "${RESEND_API_KEY_VALUE}" > alertmanager_smtp_password
chmod 600 alertmanager_smtp_password

echo "=============================================="
echo "✅ .env.prod GERADO COM SUCESSO!"
echo "=============================================="

