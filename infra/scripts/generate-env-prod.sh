#!/bin/bash
# =============================================================================
# Script: generate-env-prod.sh
# Descrição: Gera arquivo .env.prod para deploy em produção
# Autor: Fillipe Guerra
# Data: 02 de Janeiro de 2026
# =============================================================================
# REGRA 6 (CLAUDE.md): Enterprise-grade - sem mocks, sem hardcoded, persistência real
# REGRA 8: Qualidade obrigatória - validação de todas as secrets obrigatórias
# REGRA 14: Verificação de secrets existentes
#
# Uso: Este script é chamado pelo workflow deploy-production.yml
# Todas as variáveis são passadas via environment variables
# =============================================================================

set -euo pipefail

# urlencode() RFC 3986 - suporta qualquer caractere incluindo UTF-8 multi-byte
# CRITICAL (06/01/2026): Usa LC_ALL=C para processar byte-a-byte (não caractere-a-caractere)
# Sem LC_ALL=C, bash vê 'é' (UTF-8: 0xC3 0xA9) como 1 char e só encoda primeiro byte → %C3 (ERRADO)
# Com LC_ALL=C, bash vê 'é' como 2 bytes (0xC3, 0xA9) e encoda ambos → %C3%A9 (CORRETO)
urlencode() {
  local LC_ALL=C  # Force byte-oriented string processing
  local str="$1"
  local length="${#str}"
  local i c
  
  for (( i=0; i<length; i++ )); do
    c="${str:i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) printf '%s' "$c" ;;
      *) printf '%%%02X' "'$c" ;;
    esac
  done
}

echo "=============================================="
echo "GERANDO .env.prod PARA PRODUÇÃO"
echo "=============================================="

# =============================================================================
# FASE 0: Carregar versões dos componentes (Single Source of Truth)
# =============================================================================
echo "📦 Carregando versões dos componentes..."

VERSIONS_FILE="${VERSIONS_FILE:-./infra/versions.env}"

if [ ! -f "$VERSIONS_FILE" ]; then
  echo "::error::Arquivo de versões não encontrado: $VERSIONS_FILE" >&2
  echo "   O arquivo infra/versions.env é obrigatório para definir versões dos componentes." >&2
  exit 1
fi

# Carregar variáveis do arquivo (export automático)
set -a
source "$VERSIONS_FILE"
set +a

# Validar que todas as versões obrigatórias foram carregadas
REQUIRED_VERSIONS=(
  # INFRA Stack
  "PGBACKREST_VERSION"
  "CADDY_VERSION"
  "REDIS_ALICE_VERSION"
  "QDRANT_VERSION"
  "SEARXNG_VERSION"
  "MINIO_IMAGE"
  "MINIO_VERSION"
  "MINIO_MC_IMAGE"
  "MINIO_MC_VERSION"
  # OBSERVABILITY Stack
  "PROMETHEUS_VERSION"
  "GRAFANA_VERSION"
  "LOKI_VERSION"
  "PROMTAIL_VERSION"
  "JAEGER_VERSION"
  "VECTOR_VERSION"
  "OTEL_COLLECTOR_VERSION"
  "NODE_EXPORTER_VERSION"
  "CADVISOR_VERSION"
  "CLICKHOUSE_VERSION"
  "POSTGRES_LANGFUSE_VERSION"
  "LANGFUSE_VERSION"
  "LANGFUSE_WORKER_VERSION"
  # ERPNEXT Stack
  "ERPNEXT_VERSION"
  "MARIADB_VERSION"
  "REDIS_ERPNEXT_VERSION"
  # Utilities
  "BUSYBOX_VERSION"
  "PGVECTOR_TAG"
)

MISSING_VERSIONS=()
for ver in "${REQUIRED_VERSIONS[@]}"; do
  if [ -z "${!ver:-}" ]; then
    MISSING_VERSIONS+=("$ver")
  fi
done

if [ ${#MISSING_VERSIONS[@]} -gt 0 ]; then
  echo "::error::Versões obrigatórias não definidas em $VERSIONS_FILE:" >&2
  printf '  - %s\n' "${MISSING_VERSIONS[@]}" >&2
  exit 1
fi

echo "✅ Versões dos componentes carregadas (SSOT):"
echo ""
echo "   [INFRA Stack]"
echo "   PGBACKREST: ${PGBACKREST_VERSION}"
echo "   CADDY: ${CADDY_VERSION}"
echo "   REDIS_ALICE: ${REDIS_ALICE_VERSION}"
echo "   QDRANT: ${QDRANT_VERSION}"
echo "   SEARXNG: ${SEARXNG_VERSION}"
echo "   MINIO: ${MINIO_IMAGE}:${MINIO_VERSION}"
echo "   MINIO_MC: ${MINIO_MC_IMAGE}:${MINIO_MC_VERSION}"
echo ""
echo "   [OBSERVABILITY Stack]"
echo "   PROMETHEUS: ${PROMETHEUS_VERSION}"
echo "   GRAFANA: ${GRAFANA_VERSION}"
echo "   LOKI: ${LOKI_VERSION}"
echo "   PROMTAIL: ${PROMTAIL_VERSION}"
echo "   JAEGER: ${JAEGER_VERSION}"
echo "   VECTOR: ${VECTOR_VERSION}"
echo "   OTEL_COLLECTOR: ${OTEL_COLLECTOR_VERSION}"
echo "   NODE_EXPORTER: ${NODE_EXPORTER_VERSION}"
echo "   CADVISOR: ${CADVISOR_VERSION}"
echo "   CLICKHOUSE: ${CLICKHOUSE_VERSION}"
echo "   POSTGRES_LANGFUSE: ${POSTGRES_LANGFUSE_VERSION}"
echo "   LANGFUSE: ${LANGFUSE_VERSION}"
echo "   LANGFUSE_WORKER: ${LANGFUSE_WORKER_VERSION}"
echo ""
echo "   [ERPNEXT Stack]"
echo "   ERPNEXT: ${ERPNEXT_VERSION}"
echo "   MARIADB: ${MARIADB_VERSION}"
echo "   REDIS_ERPNEXT: ${REDIS_ERPNEXT_VERSION}"
echo ""

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

# VALIDAÇÃO ENTERPRISE (07/01/2026): Comprimento mínimo e blacklist de senhas comuns
# Ref: CLAUDE.md Regra 6 (Enterprise-grade), Regra 8 (Qualidade obrigatória)
if [ ${#POSTGRES_PASSWORD} -lt 16 ]; then
  echo "::error::POSTGRES_PASSWORD muito curta (${#POSTGRES_PASSWORD} caracteres). Use pelo menos 16 caracteres (recomendado: openssl rand -hex 32)." >&2
  exit 1
fi

# Validar que não está usando senha default/exemplo
if echo "${POSTGRES_PASSWORD}" | grep -qiE '^(postgres|alice|admin|password|changeme|123456)'; then
  echo "::error::POSTGRES_PASSWORD usando senha insegura/default. Gere uma senha segura: openssl rand -hex 32" >&2
  exit 1
fi

echo "✅ POSTGRES_PASSWORD validado (${#POSTGRES_PASSWORD} caracteres, seguro)"

# CORREÇÃO 23/12/2025: Validação restritiva REMOVIDA - URL-encoding no workflow suporta qualquer senha
# Antes: Validação rejeitava senhas com caracteres especiais (+/=@:?#%), forçando apenas hex
# Agora: Função urlencode() (RFC 3986 compliant + UTF-8 multi-byte correto) suporta qualquer caractere
# CORREÇÃO 06/01/2026: urlencode() agora processa UTF-8 multi-byte corretamente (LC_ALL=C)
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

# OIDC Cookie Keys - Validação adiada para após SESSION_SECRET ser carregado
OIDC_COOKIE_KEYS_INPUT="${OIDC_COOKIE_KEYS:-}"

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

# OIDC Cookie Keys - Gerado APÓS SESSION_SECRET estar disponível (31/12/2025 - Bug Fix)
# Usa o input salvo anteriormente, agora com SESSION_SECRET já carregado
if [ -z "${OIDC_COOKIE_KEYS_INPUT}" ]; then
  # Gerar keys default seguras baseadas em SESSION_SECRET (agora disponível)
  OIDC_COOKIE_KEYS="alice-oidc-key-$(echo ${SESSION_SECRET} | cut -c1-16),alice-oidc-key-$(echo ${SESSION_SECRET} | cut -c17-32)"
  echo "⚠️  OIDC_COOKIE_KEYS não definido, usando derivado de SESSION_SECRET"
else
  OIDC_COOKIE_KEYS="${OIDC_COOKIE_KEYS_INPUT}"
fi

INTERNAL_API_SECRET="${INTERNAL_API_SECRET_SECRET:-}"
if [ -z "${INTERNAL_API_SECRET}" ]; then
  echo "::error::INTERNAL_API_SECRET não definido. Configure o secret INTERNAL_API_SECRET no repositório (necessário para comunicação entre serviços)." >&2
  exit 1
fi

OPENAI_API_KEY="${OPENAI_API_KEY_SECRET:-}"
if [ -z "${OPENAI_API_KEY}" ]; then
  echo "::error::OPENAI_API_KEY não definido. Obrigatório para Vision e geração de imagens via OpenAI." >&2
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

# =============================================================================
# MINIO - Object Storage S3-Compatible para Langfuse v3 (OBRIGATÓRIO)
# CORREÇÃO 01/01/2026: Langfuse v3 REQUER S3 para armazenamento de eventos
# Ref: https://langfuse.com/self-hosting/infrastructure/blobstorage
# =============================================================================
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD_SECRET:-}"
if [ -z "${MINIO_ROOT_PASSWORD}" ]; then
  echo "::error::MINIO_ROOT_PASSWORD não definido. Configure o secret MINIO_ROOT_PASSWORD no repositório (necessário para MinIO/Langfuse v3)." >&2
  echo "   Para gerar: openssl rand -hex 32" >&2
  exit 1
fi

# CORREÇÃO 09/01/2026: Validar que senha MinIO não contém caracteres especiais de URL
# Senhas com +, /, =, @, :, ?, #, % quebram URLs MinIO (ex: MC_HOST_local=http://user:senha@host:port)
# REF: https://min.io/docs/minio/linux/reference/minio-mc/minio-client-settings.html
# Use: openssl rand -hex 32 (hexadecimal é 100% URL-safe)
if echo "${MINIO_ROOT_PASSWORD}" | grep -qE '[+/=@:?#%]'; then
  echo "::error::MINIO_ROOT_PASSWORD contém caracteres especiais de URL (+/=@:?#%). URLs MinIO (MC_HOST_local) serão malformadas. Regenere com: openssl rand -hex 32" >&2
  exit 1
fi
echo "✅ MINIO_ROOT_PASSWORD validado (obrigatório para Langfuse v3)"

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

# -----------------------------------------------------------------------------
# ERPNext MySQL Exporter (Observability ERPNext) - credencial obrigatória
# -----------------------------------------------------------------------------
# O stack ERPNext inclui mysqld_exporter. O docker-compose.erpnext.yml marca
# ERPNEXT_MYSQL_EXPORTER_PASSWORD como obrigatória (fail-fast).
#
# Recomendação enterprise: usar senha URL-safe/DSN-safe (ex: openssl rand -hex 32).
ERPNEXT_MYSQL_EXPORTER_PASSWORD="${ERPNEXT_MYSQL_EXPORTER_PASSWORD_SECRET:-}"
if [ -z "${ERPNEXT_MYSQL_EXPORTER_PASSWORD}" ]; then
  echo "::error::ERPNEXT_MYSQL_EXPORTER_PASSWORD não definido. Configure o secret ERPNEXT_MYSQL_EXPORTER_PASSWORD no repositório (credencial do MySQL exporter para observabilidade ERPNext)." >&2
  echo "   Recomendado: openssl rand -hex 32" >&2
  exit 1
fi

# DATA_SOURCE_NAME do mysqld_exporter usa formato user:pass@(host:port)/.
# Caracteres como @ e : tendem a quebrar parsing do DSN.
if echo "${ERPNEXT_MYSQL_EXPORTER_PASSWORD}" | grep -qE '[@:/?#%]'; then
  echo "::error::ERPNEXT_MYSQL_EXPORTER_PASSWORD contém caracteres que podem quebrar o DSN do MySQL exporter (@:/?#%). Regenere com: openssl rand -hex 32" >&2
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
# GMAIL SMTP (Grafana Alerting + Integrations) - App Password para autenticação
# =============================================================================
# Gmail SMTP (01/01/2026 - Alertmanager removido, Grafana Alerting assumiu):
# - Pode enviar para QUALQUER email (clientes, equipe, vendas)
# - 500 emails/dia (conta pessoal) ou 2000/dia (Google Workspace)
# - Ref: https://support.google.com/accounts/answer/185833
# =============================================================================
echo ""
echo "🔐 Validando Gmail SMTP (Grafana Alerting)..."

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
echo "✅ GMAIL_APP_PASSWORD validado (usado pelo Grafana Alerting via variável GF_SMTP_PASSWORD)"

# =============================================================================
# pgBackRest Encryption (OBRIGATÓRIO para backup enterprise AES-256-CBC)
# =============================================================================
# CORREÇÃO 02/01/2026: BACKUP_CIPHER_PASS não era validado, causando falha no pgbackrest-init
# pgBackRest criptografa repositório de backups com AES-256-CBC
# Sem esta variável, archive_command falha com "repo is encrypted but cipher not configured"
# =============================================================================
echo ""
echo "🔐 Validando pgBackRest Encryption..."

# DIAGNÓSTICO CRÍTICO 02/01/2026: Verificar se variável de ambiente foi passada
# O workflow passa BACKUP_CIPHER_PASS_SECRET: ${{ secrets.BACKUP_CIPHER_PASS }}
# Se o secret existir mas estiver vazio no GitHub, a variável chega vazia aqui
echo "   Verificando variável de ambiente BACKUP_CIPHER_PASS_SECRET..."

# Verificar se variável existe no ambiente (set vs unset)
# CORREÇÃO 02/01/2026: Usar sufixo _SECRET igual às outras variáveis (ex: POSTGRES_PASSWORD_SECRET)
if [ -z "${BACKUP_CIPHER_PASS_SECRET+x}" ]; then
  echo "::error::BACKUP_CIPHER_PASS_SECRET NÃO FOI PASSADA como variável de ambiente!" >&2
  echo "   Verifique se o workflow está passando: BACKUP_CIPHER_PASS_SECRET: \${{ secrets.BACKUP_CIPHER_PASS }}" >&2
  echo "   E se o secret BACKUP_CIPHER_PASS está configurado no GitHub." >&2
  exit 1
fi

BACKUP_CIPHER_PASS="${BACKUP_CIPHER_PASS_SECRET:-}"
# Diagnóstico: mostrar se variável existe e seu tamanho (sem revelar valor)
BACKUP_CIPHER_LEN=${#BACKUP_CIPHER_PASS}
echo "   BACKUP_CIPHER_PASS presente: SIM"
echo "   BACKUP_CIPHER_PASS tamanho: ${BACKUP_CIPHER_LEN} caracteres"

# Mostrar primeiros 4 caracteres para diagnóstico (sem revelar secret completo)
if [ ${BACKUP_CIPHER_LEN} -gt 0 ]; then
  FIRST_CHARS=$(echo "${BACKUP_CIPHER_PASS}" | cut -c1-4)
  echo "   BACKUP_CIPHER_PASS prefixo: ${FIRST_CHARS}..."
fi

if [ -z "${BACKUP_CIPHER_PASS}" ]; then
  echo "::error::BACKUP_CIPHER_PASS está VAZIO (secret existe mas sem valor). Configure o valor do secret BACKUP_CIPHER_PASS no GitHub." >&2
  echo "   O secret existe no GitHub mas o valor está vazio!" >&2
  echo "   Para gerar: openssl rand -hex 32" >&2
  echo "   Após gerar, ATUALIZE o secret em: GitHub → Settings → Secrets and variables → Actions" >&2
  exit 1
fi

# Validar tamanho mínimo (openssl rand -hex 32 gera 64 caracteres)
if [ ${BACKUP_CIPHER_LEN} -lt 32 ]; then
  echo "::error::BACKUP_CIPHER_PASS muito curto (${BACKUP_CIPHER_LEN} caracteres). Use pelo menos 32 caracteres." >&2
  echo "   Recomendado: openssl rand -hex 32 (gera 64 caracteres hexadecimais)" >&2
  exit 1
fi

# Verificar se contém caracteres problemáticos
if echo "${BACKUP_CIPHER_PASS}" | grep -qE '[$`\\]'; then
  echo "⚠️  AVISO: BACKUP_CIPHER_PASS contém caracteres especiais (\$, \`, \\)"
  echo "   Esses caracteres serão escapados no .env.prod"
fi

echo "✅ BACKUP_CIPHER_PASS validado (${BACKUP_CIPHER_LEN} chars, pgBackRest AES-256-CBC)"

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
# - Let's Encrypt (certificados SSL via Caddy)
#
# NOTA: Grafana Alerting usa GMAIL_USER para SMTP (NÃO ACME_EMAIL).
# =============================================================================
if [ -z "${ACME_EMAIL:-}" ]; then
  echo "::error::ACME_EMAIL não definido. Let's Encrypt não conseguirá emitir certificados SSL." >&2
  echo "Configure o secret ACME_EMAIL com um email válido para receber avisos do Let's Encrypt." >&2
  exit 1
fi

# =============================================================================
# FASE 7.0: Validar DUCKDNS_TOKEN (DNS-01)
# =============================================================================
if [ -z "${DUCKDNS_TOKEN:-}" ]; then
  echo "::error::DUCKDNS_TOKEN não definido. Caddy não conseguirá validar DNS-01 (DuckDNS)." >&2
  echo "Configure o secret DUCKDNS_TOKEN com o token do DuckDNS." >&2
  exit 1
fi

# =============================================================================
# FASE 7.0.1: Validar ZeroSSL EAB (ACME fallback)
# =============================================================================
if [ -z "${ZEROSSL_EAB_KID:-}" ] || [ -z "${ZEROSSL_EAB_HMAC_KEY:-}" ]; then
  echo "::error::ZeroSSL EAB não definido. Caddy não conseguirá emitir certificados via ZeroSSL." >&2
  echo "Configure os secrets ZEROSSL_EAB_KID e ZEROSSL_EAB_HMAC_KEY (EAB)." >&2
  exit 1
fi

# =============================================================================
# FASE 7.1: Validar usuário do mysqld_exporter (ERPNext)
# =============================================================================
if [ -z "${ERPNEXT_MYSQL_EXPORTER_USER:-}" ]; then
  ERPNEXT_MYSQL_EXPORTER_USER="erpnext_exporter"
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
  printf '# ==============================================\n'
  printf '# VERSÕES - SINGLE SOURCE OF TRUTH (SSOT)\n'
  printf '# ==============================================\n'
  printf '\n'
  printf '# INFRA Stack\n'
  printf 'PGBACKREST_VERSION=%s\n' "${PGBACKREST_VERSION:-2.57.0}"
  printf 'CADDY_VERSION=%s\n' "${CADDY_VERSION:-2.8.4}"
  printf 'REDIS_ALICE_VERSION=%s\n' "${REDIS_ALICE_VERSION:-7.4.7-alpine}"
  printf 'QDRANT_VERSION=%s\n' "${QDRANT_VERSION:-v1.16.2}"
  printf 'SEARXNG_VERSION=%s\n' "${SEARXNG_VERSION:-2025.12.30-a5c946a32}"
  printf 'MINIO_IMAGE=%s\n' "${MINIO_IMAGE:-quay.io/minio/minio}"
  printf 'MINIO_VERSION=%s\n' "${MINIO_VERSION:-latest}"
  printf 'MINIO_MC_IMAGE=%s\n' "${MINIO_MC_IMAGE:-quay.io/minio/mc}"
  printf 'MINIO_MC_VERSION=%s\n' "${MINIO_MC_VERSION:-latest}"
  printf '\n'
  printf '# OBSERVABILITY Stack\n'
  printf 'PROMETHEUS_VERSION=%s\n' "${PROMETHEUS_VERSION:-v3.8.1}"
  printf 'GRAFANA_VERSION=%s\n' "${GRAFANA_VERSION:-12.3.1}"
  printf 'LOKI_VERSION=%s\n' "${LOKI_VERSION:-3.6.3}"
  printf 'PROMTAIL_VERSION=%s\n' "${PROMTAIL_VERSION:-3.6.3}"
  printf 'JAEGER_VERSION=%s\n' "${JAEGER_VERSION:-2.13.0}"
  printf 'VECTOR_VERSION=%s\n' "${VECTOR_VERSION:-0.45.0-alpine}"
  printf 'OTEL_COLLECTOR_VERSION=%s\n' "${OTEL_COLLECTOR_VERSION:-0.142.0}"
  printf 'NODE_EXPORTER_VERSION=%s\n' "${NODE_EXPORTER_VERSION:-v1.9.1}"
  printf 'CADVISOR_VERSION=%s\n' "${CADVISOR_VERSION:-v0.52.1}"
  printf 'CLICKHOUSE_VERSION=%s\n' "${CLICKHOUSE_VERSION:-25.12-alpine}"
  printf 'POSTGRES_LANGFUSE_VERSION=%s\n' "${POSTGRES_LANGFUSE_VERSION:-16-alpine}"
  printf 'LANGFUSE_VERSION=%s\n' "${LANGFUSE_VERSION:-3.85.0}"
  printf 'LANGFUSE_WORKER_VERSION=%s\n' "${LANGFUSE_WORKER_VERSION:-3.85.0}"
  printf '\n'
  printf '# ERPNEXT Stack\n'
  printf 'ERPNEXT_VERSION=%s\n' "${ERPNEXT_VERSION:-v15.91.3}"
  printf 'MARIADB_VERSION=%s\n' "${MARIADB_VERSION:-10.8.8}"
  printf 'REDIS_ERPNEXT_VERSION=%s\n' "${REDIS_ERPNEXT_VERSION:-6.2.21-alpine}"
  printf '\n'
  printf '# Utilities\n'
  printf 'BUSYBOX_VERSION=%s\n' "${BUSYBOX_VERSION:-1.36.1}"
  printf 'PGVECTOR_TAG=%s\n' "${PGVECTOR_TAG:-pg16}"
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
  printf 'BASE_URL=https://yesyoudeserve.duckdns.org\n'
  printf '\n'
  printf '# OAuth GitHub\n'
  printf 'OAUTH_GITHUB_CLIENT_ID=%s\n' "${OAUTH_GITHUB_CLIENT_ID:-}"
  printf 'OAUTH_GITHUB_CLIENT_SECRET=%s\n' "${OAUTH_GITHUB_CLIENT_SECRET:-}"
  printf '\n'
  printf '# GPU Services (Hetzner GPU Server)\n'
  printf 'HUGGINGFACE_TOKEN=%s\n' "${HUGGINGFACE_TOKEN:-}"
  printf 'GPU_MANAGER_URL=http://alice-gpu-manager:3010\n'
  printf '\n'
  printf '# OpenAI (Vision + geração de imagens)\n'
  printf 'OPENAI_API_KEY=%s\n' "${OPENAI_API_KEY}"
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
  printf '# Gmail SMTP (Grafana Alerting)\n'
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
  printf 'ERPNEXT_MYSQL_EXPORTER_USER=%s\n' "${ERPNEXT_MYSQL_EXPORTER_USER}"
  printf 'ERPNEXT_MYSQL_ROOT_PASSWORD=%s\n' "${ERPNEXT_MYSQL_ROOT_PASSWORD}"
  printf 'ERPNEXT_MYSQL_EXPORTER_PASSWORD=%s\n' "${ERPNEXT_MYSQL_EXPORTER_PASSWORD}"
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
  # CORREÇÃO CRÍTICA 02/01/2026: Escapar $ no valor para evitar interpretação pelo Docker Compose
  # Se BACKUP_CIPHER_PASS contiver $, Docker Compose tenta expandir como variável
  # Ex: valor "abc$xyz" → Docker Compose expande $xyz como variável (vazia) → "abc"
  # Solução: Substituir $ por $$ (escape do Docker Compose)
  BACKUP_CIPHER_PASS_ESCAPED=$(echo "${BACKUP_CIPHER_PASS:-}" | sed 's/\$/\$\$/g')
  printf 'BACKUP_CIPHER_PASS=%s\n' "${BACKUP_CIPHER_PASS_ESCAPED}"
  printf 'PGBACKREST_STANZA=alice_prod\n'
  printf 'PGBACKREST_ALLOW_STANZA_RESET=%s\n' "${PGBACKREST_ALLOW_STANZA_RESET:-false}"
  printf '\n'
  printf '# SSL/TLS\n'
  printf 'ACME_EMAIL=%s\n' "${ACME_EMAIL:-}"
  printf 'DUCKDNS_TOKEN=%s\n' "${DUCKDNS_TOKEN}"
  printf 'ZEROSSL_EAB_KID=%s\n' "${ZEROSSL_EAB_KID}"
  printf 'ZEROSSL_EAB_HMAC_KEY=%s\n' "${ZEROSSL_EAB_HMAC_KEY}"
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
  # CORREÇÃO 08/01/2026: Usar CLICKHOUSE_USER (não CLICKHOUSE_USER_SECRET_VAL)
  # Workflow passa CLICKHOUSE_USER="${SECRET_CLICKHOUSE_USER}"
  CLICKHOUSE_USER_VALUE="${CLICKHOUSE_USER:-langfuse}"
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
  printf '# MinIO (OBRIGATÓRIO Langfuse v3)\n'
  printf 'MINIO_ROOT_USER=minioadmin\n'
  printf 'MINIO_ROOT_PASSWORD=%s\n' "${MINIO_ROOT_PASSWORD}"
  printf '\n'
  printf '# SearXNG\n'
  printf 'SEARXNG_SECRET_KEY=%s\n' "${SEARXNG_SECRET_KEY}"
} > .env.prod

# NOTA: chmod 644 permite que tar/scp leiam o arquivo durante o deploy
# As permissões são restringidas para 600 no servidor após o SCP (step SSH)
chmod 644 .env.prod

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

printf '%s' "${QDRANT_API_KEY}" > qdrant_api_key
chmod 600 qdrant_api_key

# Gmail App Password para Grafana Alerting SMTP
# NOTA 01/01/2026: Alertmanager removido, Grafana usa variável GF_SMTP_PASSWORD diretamente
# Arquivo de secret não é mais necessário - mantido apenas para retrocompatibilidade
GMAIL_APP_PASSWORD_VALUE="${GMAIL_APP_PASSWORD:-}"
if [ -z "${GMAIL_APP_PASSWORD_VALUE}" ]; then
  echo "::error::GMAIL_APP_PASSWORD é obrigatório para Grafana Alerting SMTP. Configure o secret no repositório." >&2
  exit 1
fi
echo "✅ GMAIL_APP_PASSWORD validado para Grafana Alerting SMTP"

echo "=============================================="
echo "✅ .env.prod GERADO COM SUCESSO!"
echo "=============================================="

