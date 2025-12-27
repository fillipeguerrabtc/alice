#!/usr/bin/env bash
# =============================================================================
# Script de Deploy Remoto - Alice Enterprise Platform
# =============================================================================
# Descrição: Script executado no Deploy Server que faz deploy remoto
#            no Production Server via SSH
# Autor: Fillipe Guerra
# Data: 25 de Dezembro de 2025
# Versão: 1.0
# =============================================================================
# ENTERPRISE-GRADE (2025/2026):
# - Execução no Deploy Server (isolado de produção)
# - Deploy remoto no Production Server via SSH
# - Isolamento completo entre CI/CD e produção
# =============================================================================

set -euo pipefail

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# =============================================================================
# Funções auxiliares
# =============================================================================

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

log_header() {
    echo -e "\n${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"
}

# =============================================================================
# Validação de variáveis obrigatórias
# =============================================================================

log_header "VALIDAÇÃO DE VARIÁVEIS OBRIGATÓRIAS"

REQUIRED_VARS=(
    "GH_PAT"
    "REPO_FULL_NAME"
    "GITHUB_ACTOR"
    "IMAGE_PREFIX"
    "IMAGE_TAG"
    "DEPLOY_VERSION"
    "GITHUB_SHA"
    "PRODUCTION_SERVER_HOST"
    "PRODUCTION_SERVER_USER"
    "PRODUCTION_SERVER_SSH_PRIVATE_KEY"
)

MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var:-}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    log_error "Variáveis obrigatórias não definidas: ${MISSING_VARS[*]}"
fi

log_info "Todas as variáveis obrigatórias estão definidas"

# =============================================================================
# Configuração SSH
# =============================================================================

log_header "CONFIGURANDO ACESSO SSH AO PRODUCTION SERVER"

# CORREÇÃO (27/12/2025): Defaults mais informativos para debug
# Se as variáveis estiverem vazias, o script deve falhar com mensagem clara
if [ -z "${PRODUCTION_SERVER_HOST:-}" ]; then
    log_error "PRODUCTION_SERVER_HOST não definido! Configure PRODUCTION_SERVER_HOST ou HETZNER_VM_HOST no GitHub Secrets"
fi

if [ -z "${PRODUCTION_SERVER_USER:-}" ]; then
    log_error "PRODUCTION_SERVER_USER não definido! Configure PRODUCTION_SERVER_USER ou HETZNER_VM_USER no GitHub Secrets"
fi

if [ -z "${PRODUCTION_SERVER_SSH_PRIVATE_KEY:-}" ]; then
    log_error "PRODUCTION_SERVER_SSH_PRIVATE_KEY não definido! Configure PRODUCTION_SERVER_SSH_PRIVATE_KEY ou HETZNER_SSH_PRIVATE_KEY no GitHub Secrets"
fi

# Mostrar configuração (sem expor dados sensíveis)
log_info "Host: ${PRODUCTION_SERVER_HOST}"
log_info "User: ${PRODUCTION_SERVER_USER}"
log_info "SSH Key: [CONFIGURADA - ${#PRODUCTION_SERVER_SSH_PRIVATE_KEY} chars]"

# Configurar chave SSH privada
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# CORREÇÃO (27/12/2025): Tratar possíveis formatos da chave SSH
# GitHub Secrets pode ter \n literal ou newlines reais
# printf %b interpreta \n como newlines
printf '%b' "${PRODUCTION_SERVER_SSH_PRIVATE_KEY}" > ~/.ssh/id_rsa_prod
chmod 600 ~/.ssh/id_rsa_prod

# Validar formato da chave
if ! head -1 ~/.ssh/id_rsa_prod | grep -q "BEGIN"; then
    log_error "Chave SSH inválida - não começa com BEGIN. Verifique o secret HETZNER_SSH_PRIVATE_KEY"
fi

# Debug: mostrar primeira e última linha da chave (sem expor dados)
log_info "SSH Key primeira linha: $(head -1 ~/.ssh/id_rsa_prod)"
log_info "SSH Key última linha: $(tail -1 ~/.ssh/id_rsa_prod)"
log_info "SSH Key total linhas: $(wc -l < ~/.ssh/id_rsa_prod)"

# Adicionar host ao known_hosts
ssh-keyscan -H "${PRODUCTION_SERVER_HOST}" >> ~/.ssh/known_hosts 2>/dev/null || true

# Comando SSH com chave privada e verbose para debug
SSH_CMD="ssh -i ~/.ssh/id_rsa_prod -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=30 ${PRODUCTION_SERVER_USER}@${PRODUCTION_SERVER_HOST}"
SCP_CMD="scp -i ~/.ssh/id_rsa_prod -o StrictHostKeyChecking=no"

# Testar conexão SSH com verbose em caso de falha
log_info "Testando conexão SSH ao Production Server..."
if ! $SSH_CMD "echo 'SSH OK'" 2>&1; then
    log_warn "Tentando com verbose para diagnóstico..."
    ssh -vvv -i ~/.ssh/id_rsa_prod -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=30 ${PRODUCTION_SERVER_USER}@${PRODUCTION_SERVER_HOST} "echo 'SSH OK'" 2>&1 || true
    log_error "Falha ao conectar ao Production Server via SSH. Verifique: 1) IP correto, 2) Usuário correto, 3) Chave SSH autorizada no servidor"
fi

log_info "Conexão SSH validada"

# =============================================================================
# Preparar arquivos para transferência
# =============================================================================

log_header "PREPARANDO ARQUIVOS PARA TRANSFERÊNCIA"

# Criar diretório temporário
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Copiar .env.prod se existir
if [ -f .env.prod ]; then
    cp .env.prod "$TEMP_DIR/.env.prod"
    chmod 600 "$TEMP_DIR/.env.prod"
    log_info ".env.prod preparado para transferência"
else
    log_warn ".env.prod não encontrado (será gerado no Production Server)"
fi

# Copiar secrets se existirem
if [ -f langfuse_db_password ]; then
    cp langfuse_db_password "$TEMP_DIR/langfuse_db_password"
    chmod 600 "$TEMP_DIR/langfuse_db_password"
    log_info "langfuse_db_password preparado"
fi

if [ -f alertmanager_smtp_password ]; then
    cp alertmanager_smtp_password "$TEMP_DIR/alertmanager_smtp_password"
    chmod 600 "$TEMP_DIR/alertmanager_smtp_password"
    log_info "alertmanager_smtp_password preparado"
fi

# =============================================================================
# Transferir arquivos para Production Server
# =============================================================================

log_header "TRANSFERINDO ARQUIVOS PARA PRODUCTION SERVER"

# SCP_CMD já foi definido acima (com chave SSH privada)

if [ -f "$TEMP_DIR/.env.prod" ]; then
    $SCP_CMD "$TEMP_DIR/.env.prod" "${PRODUCTION_SERVER_USER}@${PRODUCTION_SERVER_HOST}:/tmp/.env.prod" || log_error "Falha ao transferir .env.prod"
    log_info ".env.prod transferido"
fi

if [ -f "$TEMP_DIR/langfuse_db_password" ]; then
    $SCP_CMD "$TEMP_DIR/langfuse_db_password" "${PRODUCTION_SERVER_USER}@${PRODUCTION_SERVER_HOST}:/tmp/langfuse_db_password" || log_error "Falha ao transferir langfuse_db_password"
    log_info "langfuse_db_password transferido"
fi

if [ -f "$TEMP_DIR/alertmanager_smtp_password" ]; then
    $SCP_CMD "$TEMP_DIR/alertmanager_smtp_password" "${PRODUCTION_SERVER_USER}@${PRODUCTION_SERVER_HOST}:/tmp/alertmanager_smtp_password" || log_error "Falha ao transferir alertmanager_smtp_password"
    log_info "alertmanager_smtp_password transferido"
fi

# =============================================================================
# Executar Deploy Remoto
# =============================================================================

log_header "EXECUTANDO DEPLOY REMOTO NO PRODUCTION SERVER"

# Exportar todas as variáveis de ambiente necessárias
ENV_VARS="GH_PAT=${GH_PAT}"
ENV_VARS="${ENV_VARS} REPO_FULL_NAME=${REPO_FULL_NAME}"
ENV_VARS="${ENV_VARS} GITHUB_ACTOR=${GITHUB_ACTOR}"
ENV_VARS="${ENV_VARS} IMAGE_PREFIX=${IMAGE_PREFIX}"
ENV_VARS="${ENV_VARS} IMAGE_TAG=${IMAGE_TAG}"
ENV_VARS="${ENV_VARS} DEPLOY_VERSION=${DEPLOY_VERSION}"
ENV_VARS="${ENV_VARS} GITHUB_SHA=${GITHUB_SHA}"
ENV_VARS="${ENV_VARS} DEPLOY_SERVICES=${DEPLOY_SERVICES:-all}"

# Adicionar versões de componentes (se definidas)
[ -n "${PGBACKREST_VERSION:-}" ] && ENV_VARS="${ENV_VARS} PGBACKREST_VERSION=${PGBACKREST_VERSION}"
[ -n "${TRAEFIK_VERSION:-}" ] && ENV_VARS="${ENV_VARS} TRAEFIK_VERSION=${TRAEFIK_VERSION}"
[ -n "${TRAEFIK_DIGEST:-}" ] && ENV_VARS="${ENV_VARS} TRAEFIK_DIGEST=${TRAEFIK_DIGEST}"
[ -n "${PROMETHEUS_VERSION:-}" ] && ENV_VARS="${ENV_VARS} PROMETHEUS_VERSION=${PROMETHEUS_VERSION}"
[ -n "${PROMETHEUS_DIGEST:-}" ] && ENV_VARS="${ENV_VARS} PROMETHEUS_DIGEST=${PROMETHEUS_DIGEST}"
[ -n "${GRAFANA_VERSION:-}" ] && ENV_VARS="${ENV_VARS} GRAFANA_VERSION=${GRAFANA_VERSION}"
[ -n "${GRAFANA_DIGEST:-}" ] && ENV_VARS="${ENV_VARS} GRAFANA_DIGEST=${GRAFANA_DIGEST}"
[ -n "${LOKI_VERSION:-}" ] && ENV_VARS="${ENV_VARS} LOKI_VERSION=${LOKI_VERSION}"
[ -n "${LOKI_DIGEST:-}" ] && ENV_VARS="${ENV_VARS} LOKI_DIGEST=${LOKI_DIGEST}"
[ -n "${PROMTAIL_VERSION:-}" ] && ENV_VARS="${ENV_VARS} PROMTAIL_VERSION=${PROMTAIL_VERSION}"
[ -n "${PROMTAIL_DIGEST:-}" ] && ENV_VARS="${ENV_VARS} PROMTAIL_DIGEST=${PROMTAIL_DIGEST}"
[ -n "${JAEGER_VERSION:-}" ] && ENV_VARS="${ENV_VARS} JAEGER_VERSION=${JAEGER_VERSION}"
[ -n "${JAEGER_DIGEST:-}" ] && ENV_VARS="${ENV_VARS} JAEGER_DIGEST=${JAEGER_DIGEST}"
[ -n "${LANGFUSE_VERSION:-}" ] && ENV_VARS="${ENV_VARS} LANGFUSE_VERSION=${LANGFUSE_VERSION}"
[ -n "${LANGFUSE_DIGEST:-}" ] && ENV_VARS="${ENV_VARS} LANGFUSE_DIGEST=${LANGFUSE_DIGEST}"
[ -n "${ERPNEXT_VERSION:-}" ] && ENV_VARS="${ENV_VARS} ERPNEXT_VERSION=${ERPNEXT_VERSION}"
[ -n "${ERPNEXT_DIGEST:-}" ] && ENV_VARS="${ENV_VARS} ERPNEXT_DIGEST=${ERPNEXT_DIGEST}"
[ -n "${DOCKER_SOCKET_PROXY_VERSION:-}" ] && ENV_VARS="${ENV_VARS} DOCKER_SOCKET_PROXY_VERSION=${DOCKER_SOCKET_PROXY_VERSION}"
[ -n "${DOCKER_SOCKET_PROXY_DIGEST:-}" ] && ENV_VARS="${ENV_VARS} DOCKER_SOCKET_PROXY_DIGEST=${DOCKER_SOCKET_PROXY_DIGEST}"
[ -n "${BUSYBOX_VERSION:-}" ] && ENV_VARS="${ENV_VARS} BUSYBOX_VERSION=${BUSYBOX_VERSION}"
[ -n "${BUSYBOX_DIGEST:-}" ] && ENV_VARS="${ENV_VARS} BUSYBOX_DIGEST=${BUSYBOX_DIGEST}"
[ -n "${REDIS_VERSION:-}" ] && ENV_VARS="${ENV_VARS} REDIS_VERSION=${REDIS_VERSION}"
[ -n "${REDIS_DIGEST:-}" ] && ENV_VARS="${ENV_VARS} REDIS_DIGEST=${REDIS_DIGEST}"
[ -n "${MARIADB_VERSION:-}" ] && ENV_VARS="${ENV_VARS} MARIADB_VERSION=${MARIADB_VERSION}"
[ -n "${MARIADB_DIGEST:-}" ] && ENV_VARS="${ENV_VARS} MARIADB_DIGEST=${MARIADB_DIGEST}"
[ -n "${PGVECTOR_TAG:-}" ] && ENV_VARS="${ENV_VARS} PGVECTOR_TAG=${PGVECTOR_TAG}"
[ -n "${PGVECTOR_DIGEST:-}" ] && ENV_VARS="${ENV_VARS} PGVECTOR_DIGEST=${PGVECTOR_DIGEST}"
[ -n "${DOCKERHUB_USERNAME:-}" ] && ENV_VARS="${ENV_VARS} DOCKERHUB_USERNAME=${DOCKERHUB_USERNAME}"
[ -n "${DOCKERHUB_TOKEN:-}" ] && ENV_VARS="${ENV_VARS} DOCKERHUB_TOKEN=${DOCKERHUB_TOKEN}"

# Executar deploy-local.sh no Production Server
log_info "Executando deploy-local.sh no Production Server..."

$SSH_CMD bash <<EOF
set -euo pipefail

# Exportar variáveis de ambiente
export ${ENV_VARS}

# Executar deploy-local.sh
cd /opt/alice/app || { echo "❌ ERRO: Diretório /opt/alice/app não encontrado"; exit 1; }

if [ ! -f "infra/scripts/deploy-local.sh" ]; then
    echo "❌ ERRO: deploy-local.sh não encontrado"
    exit 1
fi

chmod +x infra/scripts/deploy-local.sh
bash infra/scripts/deploy-local.sh
EOF

DEPLOY_EXIT_CODE=$?

if [ "$DEPLOY_EXIT_CODE" -eq 0 ]; then
    log_info "✅ Deploy remoto concluído com sucesso!"
else
    log_error "❌ Deploy remoto falhou (exit code: $DEPLOY_EXIT_CODE)"
fi

# =============================================================================
# Limpeza
# =============================================================================

log_header "LIMPEZA"

# Limpar arquivos temporários no Production Server
$SSH_CMD "rm -f /tmp/.env.prod /tmp/langfuse_db_password /tmp/alertmanager_smtp_password" || true

log_info "Limpeza concluída"

log_info "✅ Deploy remoto finalizado com sucesso!"

