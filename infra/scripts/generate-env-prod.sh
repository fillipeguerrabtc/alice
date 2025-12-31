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

# urlencode() RFC 3986 - suporta qualquer caractere (ASCII seguro)
urlencode() {
  local str="$1"
  local length="${#str}"
  local i c ascii hex
  for (( i=0; i<length; i++ )); do
    c="${str:i:1}"
    case "$c" in
      [_.~a-zA-Z0-9-]) printf '%s' "$c" ;;
      *) printf -v ascii '%d' "'$c"; printf -v hex '%%%02X' "$ascii"; printf '%s' "$hex" ;;
    esac
  done
}

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

# =============================================================================
# ADMIN CREDENTIALS - Arquitetura Enterprise 2025 (CORRIGIDO 31/12/2025)
# =============================================================================
# TODOS OS 3 SISTEMAS REQUEREM CREDENCIAIS ADMIN OBRIGATÓRIAS:
#
# 1. ALICE AUTH SERVICE (IdP Central):
#    - ADMIN_USER: Email obrigatório (ex: admin@yesyoudeserve.duckdns.org)
#    - ADMIN_PWD: Senha mínimo 8 caracteres
#    - Cria super_admin automaticamente via ensureGlobalAdmin()
#    - Ref: apps/auth-service/src/index.ts linha 203 - z.string().email()
#
# 2. GRAFANA 12 (Observability):
#    - GRAFANA_ADMIN_USER: Qualquer string (default "admin")
#    - GRAFANA_ADMIN_PASSWORD: Senha (recomendado 8+ chars)
#    - Ref: https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/
#
# 3. ERPNEXT 15 (ERP/CRM):
#    - Username: FIXO "Administrator" (não pode mudar - Frappe Framework)
#    - ERPNEXT_ADMIN_PASSWORD: Senha mínimo 8 caracteres (Frappe default)
#    - Ref: https://frappeframework.com/docs/user/en/basics/users-and-permissions
# =============================================================================

echo "🔐 Validando credenciais admin (Alice + Grafana + ERPNext)..."

# -----------------------------------------------------------------------------
# ALICE AUTH SERVICE - ADMIN_USER (email) + ADMIN_PWD (obrigatórios)
# -----------------------------------------------------------------------------
ADMIN_USER="${ADMIN_USER_SECRET:-}"
ADMIN_PWD="${ADMIN_PWD_SECRET:-}"

if [ -z "${ADMIN_USER}" ]; then
  echo "::error::ADMIN_USER não definido. Configure o secret ADMIN_USER (email válido, ex: admin@yesyoudeserve.duckdns.org)." >&2
  exit 1
fi

if [ -z "${ADMIN_PWD}" ]; then
  echo "::error::ADMIN_PWD não definido. Configure o secret ADMIN_PWD (mínimo 8 caracteres)." >&2
  exit 1
fi

# Validar formato de email para ADMIN_USER
if ! echo "${ADMIN_USER}" | grep -qE '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'; then
  echo "::error::ADMIN_USER deve ser um email válido. Valor fornecido: ${ADMIN_USER}" >&2
  exit 1
fi

# Validar comprimento mínimo de ADMIN_PWD
if [ ${#ADMIN_PWD} -lt 8 ]; then
  echo "::error::ADMIN_PWD deve ter no mínimo 8 caracteres. Comprimento atual: ${#ADMIN_PWD}" >&2
  exit 1
fi

echo "✅ Alice Auth: ${ADMIN_USER} (email válido, senha 8+ chars)"

# -----------------------------------------------------------------------------
# GRAFANA 12 - GRAFANA_ADMIN_USER + GRAFANA_ADMIN_PASSWORD (obrigatórios)
# -----------------------------------------------------------------------------
GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER_SECRET:-}"
GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD_SECRET:-}"

if [ -z "${GRAFANA_ADMIN_USER}" ]; then
  echo "::error::GRAFANA_ADMIN_USER não definido. Configure o secret GRAFANA_ADMIN_USER (ex: admin)." >&2
  exit 1
fi

if [ -z "${GRAFANA_ADMIN_PASSWORD}" ]; then
  echo "::error::GRAFANA_ADMIN_PASSWORD não definido. Configure o secret GRAFANA_ADMIN_PASSWORD." >&2
  exit 1
fi

# Grafana 12: Aviso se senha curta (não bloqueia, mas recomenda)
if [ ${#GRAFANA_ADMIN_PASSWORD} -lt 8 ]; then
  echo "⚠️  AVISO: GRAFANA_ADMIN_PASSWORD tem menos de 8 caracteres. Recomendado senha mais forte."
fi

echo "✅ Grafana 12: ${GRAFANA_ADMIN_USER} (username customizável)"

# -----------------------------------------------------------------------------
# ERPNEXT 15 - Username fixo "Administrator" + ERPNEXT_ADMIN_PASSWORD (obrigatório)
# -----------------------------------------------------------------------------
ERPNEXT_ADMIN_PASSWORD="${ERPNEXT_ADMIN_PASSWORD_SECRET:-}"

if [ -z "${ERPNEXT_ADMIN_PASSWORD}" ]; then
  echo "::error::ERPNEXT_ADMIN_PASSWORD não definido. Configure o secret ERPNEXT_ADMIN_PASSWORD (mínimo 8 caracteres)." >&2
  exit 1
fi

# ERPNext 15: Frappe requer mínimo 8 caracteres por default
if [ ${#ERPNEXT_ADMIN_PASSWORD} -lt 8 ]; then
  echo "::error::ERPNEXT_ADMIN_PASSWORD deve ter no mínimo 8 caracteres (requisito Frappe). Comprimento atual: ${#ERPNEXT_ADMIN_PASSWORD}" >&2
  exit 1
fi

echo "✅ ERPNext 15: Administrator (username fixo, senha 8+ chars)"
echo "✅ Todas as credenciais admin validadas com sucesso"

# =============================================================================
# SSO OAUTH CLIENTS - SECRETS PRÉ-DEFINIDOS (31/12/2025)
# =============================================================================
# Deploy 100% automatizado - secrets definidos no GitHub, não gerados em runtime
# Isso elimina passos manuais pós-deploy para configurar SSO
# =============================================================================
echo ""
echo "🔐 Validando OAuth/OIDC Secrets (SSO Automatizado)..."

GRAFANA_OAUTH_CLIENT_SECRET="${GRAFANA_OAUTH_CLIENT_SECRET:-}"
if [ -z "${GRAFANA_OAUTH_CLIENT_SECRET}" ]; then
  echo "::error::GRAFANA_OAUTH_CLIENT_SECRET não definido. Configure o secret no GitHub." >&2
  echo "   Para gerar: openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'" >&2
  exit 1
fi

ERPNEXT_OAUTH_CLIENT_SECRET="${ERPNEXT_OAUTH_CLIENT_SECRET:-}"
if [ -z "${ERPNEXT_OAUTH_CLIENT_SECRET}" ]; then
  echo "::error::ERPNEXT_OAUTH_CLIENT_SECRET não definido. Configure o secret no GitHub." >&2
  echo "   Para gerar: openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'" >&2
  exit 1
fi

# OIDC Cookie Keys (opcional - default seguro se não definido)
OIDC_COOKIE_KEYS="${OIDC_COOKIE_KEYS:-}"
if [ -z "${OIDC_COOKIE_KEYS}" ]; then
  # Gerar keys default seguras baseadas em SESSION_SECRET
  OIDC_COOKIE_KEYS="alice-oidc-key-$(echo ${SESSION_SECRET} | cut -c1-16),alice-oidc-key-$(echo ${SESSION_SECRET} | cut -c17-32)"
  echo "⚠️  OIDC_COOKIE_KEYS não definido, usando derivado de SESSION_SECRET"
fi

echo "✅ GRAFANA_OAUTH_CLIENT_SECRET validado (grafana-sso)"
echo "✅ ERPNEXT_OAUTH_CLIENT_SECRET validado (erpnext-sso)"
echo "✅ OAuth/OIDC Secrets validados para SSO automatizado"

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

# =============================================================================
# GMAIL SMTP (Alertmanager + Integrations) - App Password para autenticação
# =============================================================================
# Gmail SMTP (30/12/2025):
# - Pode enviar para QUALQUER email (clientes, equipe, vendas)
# - 500 emails/dia (conta pessoal) ou 2000/dia (Google Workspace)
# - Ref: https://support.google.com/accounts/answer/185833
# =============================================================================
echo ""
echo "🔐 Validando Gmail SMTP (Alertmanager)..."

# GMAIL_USER: Email Gmail completo para autenticação SMTP
GMAIL_USER="${GMAIL_USER:-}"
if [ -z "${GMAIL_USER}" ]; then
  echo "::error::GMAIL_USER não definido. Configure o secret GMAIL_USER no repositório (ex: seuemail@gmail.com)." >&2
  exit 1
fi

# GMAIL_APP_PASSWORD: Senha de 16 caracteres gerada em myaccount.google.com/apppasswords
GMAIL_APP_PASSWORD="${GMAIL_APP_PASSWORD:-}"
if [ -z "${GMAIL_APP_PASSWORD}" ]; then
  echo "::error::GMAIL_APP_PASSWORD não definido. Configure o secret GMAIL_APP_PASSWORD no repositório." >&2
  echo "   Para criar: https://myaccount.google.com/apppasswords" >&2
  echo "   Selecione 'Mail' e 'Other', gere a senha de 16 caracteres." >&2
  exit 1
fi

echo "✅ GMAIL_USER validado: ${GMAIL_USER}"
echo "✅ GMAIL_APP_PASSWORD validado (usado pelo Alertmanager via arquivo de secret)"

echo "✅ Todas as secrets obrigatórias validadas"

# =============================================================================
# FASE 3: Secrets Opcionais (Stripe, Wise, ERPNext API)
# =============================================================================
echo "🔄 Configurando secrets opcionais..."

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
# FASE 5: Validação Langfuse (v3 - OBRIGATÓRIO)
# =============================================================================
# Langfuse v3 requer essas variáveis para inicialização do servidor Next.js
# Sem elas, o Langfuse falha com erro: "Cannot set property message of ZodError"
# Ref: https://langfuse.com/docs/deployment/v3/overview
# =============================================================================

# 5.1 Variáveis de autenticação Langfuse (OBRIGATÓRIAS)
LANGFUSE_SECRET_KEY="${LANGFUSE_SECRET_KEY:-}"
if [ -z "${LANGFUSE_SECRET_KEY}" ]; then
  echo "::error::LANGFUSE_SECRET_KEY não definido. Configure o secret LANGFUSE_SECRET_KEY (obrigatório para API Langfuse v3)." >&2
  exit 1
fi

LANGFUSE_NEXT_AUTH_SECRET="${LANGFUSE_NEXT_AUTH_SECRET:-}"
if [ -z "${LANGFUSE_NEXT_AUTH_SECRET}" ]; then
  echo "::error::LANGFUSE_NEXT_AUTH_SECRET não definido. Configure o secret LANGFUSE_NEXT_AUTH_SECRET (obrigatório para autenticação Langfuse v3)." >&2
  exit 1
fi

LANGFUSE_SALT="${LANGFUSE_SALT:-}"
if [ -z "${LANGFUSE_SALT}" ]; then
  echo "::error::LANGFUSE_SALT não definido. Configure o secret LANGFUSE_SALT (obrigatório para criptografia Langfuse v3). Use: openssl rand -hex 32" >&2
  exit 1
fi

LANGFUSE_ENCRYPTION_KEY="${LANGFUSE_ENCRYPTION_KEY:-}"
if [ -z "${LANGFUSE_ENCRYPTION_KEY}" ]; then
  echo "::error::LANGFUSE_ENCRYPTION_KEY não definido. Configure o secret LANGFUSE_ENCRYPTION_KEY (obrigatório para criptografia Langfuse v3). Use: openssl rand -hex 32" >&2
  exit 1
fi

echo "✅ Variáveis de autenticação Langfuse validadas"

# 5.2 Variáveis de banco de dados Langfuse
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

echo "✅ Variáveis de banco de dados Langfuse validadas"

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
# FASE 7: Validar ACME_EMAIL (usado APENAS para Let's Encrypt)
# =============================================================================
# ACME_EMAIL é usado APENAS para:
# - Let's Encrypt (certificados SSL via Traefik)
#
# NOTA: Alertmanager usa GMAIL_USER para SMTP (NÃO ACME_EMAIL).
# Ver docker-compose.prod.yml linha 2809: ALERT_EMAIL: ${GMAIL_USER}
# =============================================================================
if [ -z "${ACME_EMAIL:-}" ]; then
  echo "::warning::ACME_EMAIL não definido. Let's Encrypt não conseguirá emitir certificados SSL."
  echo "   Configure o secret ACME_EMAIL com um email válido para receber avisos do Let's Encrypt."
fi

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
  printf '# CORS e WebSocket\n'
  printf 'CORS_ORIGIN=%s\n' "${CORS_ORIGIN_VALUE}"
  printf 'CORS_ORIGINS=%s\n' "${CORS_ORIGINS_VALUE}"
  # CORREÇÃO 29/12/2025: WEBSOCKET_ALLOWED_ORIGINS obrigatório para chat-service
  # Usado no handshake WebSocket - alinhado com CORS_ORIGINS
  printf 'WEBSOCKET_ALLOWED_ORIGINS=%s\n' "${CORS_ORIGINS_VALUE}"
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
  printf '# Gmail SMTP (Alertmanager)\n'
  printf 'GMAIL_USER=%s\n' "${GMAIL_USER}"
  printf 'GMAIL_APP_PASSWORD=%s\n' "${GMAIL_APP_PASSWORD}"
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
  printf 'PGBACKREST_STANZA=alice_prod\n'
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
  printf '# Admin centralizado (Alice Auth Service)\n'
  printf 'ADMIN_USER=%s\n' "${ADMIN_USER}"
  printf 'ADMIN_PWD=%s\n' "${ADMIN_PWD}"
  printf '\n'
  printf '# SSO OAuth/OIDC (Deploy 100%% Automatizado - 31/12/2025)\n'
  printf '# Client secrets pré-definidos para Grafana e ERPNext SSO\n'
  printf 'GRAFANA_OAUTH_CLIENT_SECRET=%s\n' "${GRAFANA_OAUTH_CLIENT_SECRET}"
  printf 'ERPNEXT_OAUTH_CLIENT_SECRET=%s\n' "${ERPNEXT_OAUTH_CLIENT_SECRET}"
  printf 'OIDC_COOKIE_KEYS=%s\n' "${OIDC_COOKIE_KEYS}"
  printf 'OIDC_ISSUER=https://yesyoudeserve.duckdns.org\n'
  printf 'GRAFANA_URL=https://observability.yesyoudeserve.duckdns.org\n'
  printf 'ERPNEXT_URL=https://erp.yesyoudeserve.duckdns.org\n'
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
  CLICKHOUSE_DB_VALUE="${CLICKHOUSE_DB:-langfuse}"
  CLICKHOUSE_USER_ENC=$(urlencode "${CLICKHOUSE_USER_VALUE}")
  CLICKHOUSE_PASSWORD_ENC=$(urlencode "${CLICKHOUSE_PASSWORD}")
  CLICKHOUSE_MIGRATION_URL_VALUE="clickhouse://${CLICKHOUSE_USER_ENC}:${CLICKHOUSE_PASSWORD_ENC}@clickhouse:9000/${CLICKHOUSE_DB_VALUE}"
  printf 'CLICKHOUSE_USER=%s\n' "${CLICKHOUSE_USER_VALUE}"
  printf 'CLICKHOUSE_PASSWORD=%s\n' "${CLICKHOUSE_PASSWORD}"
  printf 'CLICKHOUSE_DB=%s\n' "${CLICKHOUSE_DB_VALUE}"
  printf 'CLICKHOUSE_MIGRATION_URL=%s\n' "${CLICKHOUSE_MIGRATION_URL_VALUE}"
  printf 'CLICKHOUSE_HTTP_URL=%s\n' "http://clickhouse:8123"
  printf 'CLICKHOUSE_CLUSTER_ENABLED=false\n'
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

# Gmail App Password para Alertmanager SMTP
GMAIL_APP_PASSWORD_VALUE="${GMAIL_APP_PASSWORD:-}"
if [ -z "${GMAIL_APP_PASSWORD_VALUE}" ]; then
  echo "::error::GMAIL_APP_PASSWORD é obrigatório para alertmanager SMTP. Configure o secret no repositório." >&2
  exit 1
fi
printf '%s' "${GMAIL_APP_PASSWORD_VALUE}" > alertmanager_smtp_password
chmod 600 alertmanager_smtp_password
echo "✅ alertmanager_smtp_password criado (Gmail App Password)"

echo "=============================================="
echo "✅ .env.prod GERADO COM SUCESSO!"
echo "=============================================="

