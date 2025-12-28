#!/usr/bin/env bash
# =============================================================================
# Script de Deploy Local - Alice Enterprise Platform
# =============================================================================
# Descrição: Script de deploy que pode ser executado localmente no servidor
#            Hetzner (via self-hosted runner) ou via SSH
# Autor: Fillipe Guerra
# Data: 25 de Dezembro de 2025
# Versão: 1.0
# =============================================================================
# ENTERPRISE-GRADE (2025/2026):
# - Execução local (zero latência) via self-hosted runner
# - Fallback para SSH se runner não disponível
# - Versionamento automático de infraestrutura
# - Cache local de imagens Docker
# - Rollback automático via Git revert
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
# ETAPA 1: CRIAR ESTRUTURA DE DIRETÓRIOS
# =============================================================================

log_header "ETAPA 1: CRIANDO ESTRUTURA DE DIRETÓRIOS"

mkdir -p /opt/alice/{app,data,logs,backups,uploads,secrets}
mkdir -p /opt/alice/secrets/alertmanager
chmod -R 700 /opt/alice/secrets

log_info "Diretórios de secrets criados"

# =============================================================================
# ETAPA 2: MOVER SECRETS (se vieram via SCP)
# =============================================================================

log_header "ETAPA 2: PREPARANDO SECRETS"

# CORREÇÃO 28/12/2025: Verificar e remover diretórios conflitantes
# Se um diretório existe onde deveria haver um arquivo, removê-lo primeiro
if [ -d /opt/alice/secrets/langfuse_db_password ]; then
    log_warn "Encontrado diretório conflitante: /opt/alice/secrets/langfuse_db_password (removendo)"
    rm -rf /opt/alice/secrets/langfuse_db_password
fi

if [ -d /opt/alice/secrets/alertmanager/smtp_password ]; then
    log_warn "Encontrado diretório conflitante: /opt/alice/secrets/alertmanager/smtp_password (removendo)"
    rm -rf /opt/alice/secrets/alertmanager/smtp_password
fi

if [ -f /tmp/langfuse_db_password ]; then
    mv /tmp/langfuse_db_password /opt/alice/secrets/langfuse_db_password
    chmod 600 /opt/alice/secrets/langfuse_db_password
    log_info "langfuse_db_password movido"
else
    log_warn "langfuse_db_password não encontrado em /tmp (pode ser normal em self-hosted runner)"
fi

if [ -f /tmp/alertmanager_smtp_password ]; then
    mv /tmp/alertmanager_smtp_password /opt/alice/secrets/alertmanager/smtp_password
    chmod 600 /opt/alice/secrets/alertmanager/smtp_password
    log_info "alertmanager_smtp_password movido"
else
    log_warn "alertmanager_smtp_password não encontrado em /tmp (pode ser normal em self-hosted runner)"
fi

# =============================================================================
# ETAPA 3: INFORMAÇÕES DO DEPLOY
# =============================================================================

log_header "ALICE ENTERPRISE - DEPLOY PRODUÇÃO"

echo "Domínio: yesyoudeserve.duckdns.org"
echo "Commit: ${GITHUB_SHA}"
echo "Image Prefix: ${IMAGE_PREFIX}"
echo "Image Tag: ${IMAGE_TAG}"
echo "Serviços: ${DEPLOY_SERVICES:-all}"
echo "Repositório: ${REPO_FULL_NAME}"
echo "Timestamp: $(date)"

# =============================================================================
# ETAPA 4: SETUP INICIAL (se necessário)
# =============================================================================

if [ ! -f /opt/alice/.setup-complete ]; then
    log_header "PRIMEIRA EXECUÇÃO - EXECUTANDO SETUP AUTOMÁTICO"
    
    SETUP_SCRIPT="/tmp/setup-hetzner-gpu.sh"
    curl -fsSL "https://raw.githubusercontent.com/${REPO_FULL_NAME}/main/infra/scripts/setup-hetzner-gpu.sh" -o "$SETUP_SCRIPT" || {
        log_warn "Não foi possível baixar script de setup. Continuando com verificação manual..."
        SETUP_SCRIPT=""
    }
    
    if [ -n "$SETUP_SCRIPT" ] && [ -f "$SETUP_SCRIPT" ]; then
        chmod +x "$SETUP_SCRIPT"
        bash "$SETUP_SCRIPT" || log_warn "Setup script teve avisos, mas continuando..."
        touch /opt/alice/.setup-complete
        log_info "Setup automático concluído"
    fi
else
    log_info "Setup já foi executado anteriormente (pulando)"
fi

# =============================================================================
# ETAPA 5: VERIFICAÇÃO DE REQUISITOS
# =============================================================================

log_header "VERIFICANDO REQUISITOS DO SERVIDOR"

# Verificar Docker
if ! command -v docker &> /dev/null; then
    log_error "Docker não está instalado. Execute setup-hetzner-gpu.sh primeiro."
fi
log_info "Docker: $(docker --version | head -1)"

# Verificar Docker Compose
if ! docker compose version &> /dev/null; then
    log_error "Docker Compose não está disponível"
fi
log_info "Docker Compose: $(docker compose version | head -1)"

# Verificar Git
if ! command -v git &> /dev/null; then
    log_info "Instalando Git..."
    apt-get update -qq && apt-get install -y git >/dev/null 2>&1 || log_error "Falha ao instalar Git"
fi
log_info "Git: $(git --version)"

# Verificar Python3
if ! command -v python3 &> /dev/null; then
    log_info "Instalando Python3..."
    apt-get update -qq && apt-get install -y python3 >/dev/null 2>&1 || log_error "Falha ao instalar Python3"
fi
log_info "Python: $(python3 --version)"

# Verificar pip3
if ! command -v pip3 &> /dev/null; then
    log_info "Instalando pip3..."
    apt-get update -qq && apt-get install -y python3-pip >/dev/null 2>&1 || log_error "Falha ao instalar pip3"
fi

# Verificar ruamel.yaml
if ! python3 -c "import ruamel.yaml" &> /dev/null; then
    log_info "Instalando ruamel.yaml..."
    apt-get update -qq && apt-get install -y python3-ruamel.yaml >/dev/null 2>&1 || {
        export PIP_BREAK_SYSTEM_PACKAGES=1
        pip3 install --upgrade pip >/dev/null 2>&1 || true
        pip3 install ruamel.yaml || log_error "Falha ao instalar ruamel.yaml"
    }
fi
log_info "ruamel.yaml: instalado"

log_info "Todos os requisitos verificados"

# =============================================================================
# ETAPA 6: CRIAR ESTRUTURA DE DIRETÓRIOS PARA BIND MOUNTS
# =============================================================================

log_header "CRIANDO ESTRUTURA DE DIRETÓRIOS PARA BIND MOUNTS"

# Subdiretórios de data
mkdir -p /opt/alice/data/{postgres,redis-alice,qdrant,traefik-acme,searxng-config,erpnext-sites,erpnext-mariadb,erpnext-redis-cache,erpnext-redis-queue,vector,alertmanager,langfuse-db,clickhouse,prometheus,grafana,loki}

# Subdiretórios de logs
mkdir -p /opt/alice/logs/{erpnext,clickhouse}

# Subdiretórios de backups
mkdir -p /opt/alice/backups/postgresql/logs

# Configurar permissões enterprise por serviço
chown -R 472:472 /opt/alice/data/grafana
chown -R 65534:65534 /opt/alice/data/{prometheus,alertmanager}
chown -R 10001:10001 /opt/alice/data/loki
chown -R 70:70 /opt/alice/data/langfuse-db
chown -R 101:101 /opt/alice/data/clickhouse
chown -R 101:101 /opt/alice/logs/clickhouse
chown -R 999:999 /opt/alice/data/{postgres,redis-alice,erpnext-mariadb,erpnext-redis-cache,erpnext-redis-queue}
chown -R 1001:1001 /opt/alice/data/traefik-acme
chown -R 977:977 /opt/alice/data/searxng-config
chown -R 1000:1000 /opt/alice/data/erpnext-sites
chown -R 1000:1000 /opt/alice/uploads
chown -R 1000:1000 /opt/alice/logs/erpnext

chmod -R 700 /opt/alice/data/postgres
chmod -R 700 /opt/alice/data/traefik-acme
chmod -R 755 /opt/alice/data/{grafana,prometheus,loki,alertmanager,langfuse-db,clickhouse,redis-alice,qdrant,vector,searxng-config,erpnext-sites,erpnext-mariadb,erpnext-redis-cache,erpnext-redis-queue}
chmod -R 755 /opt/alice/logs/clickhouse
chmod -R 750 /opt/alice/{logs,backups,uploads}

log_info "Estrutura de diretórios criada com permissões enterprise"

# =============================================================================
# ETAPA 7: CLONE/UPDATE DO REPOSITÓRIO
# =============================================================================

log_header "CLONE/UPDATE DO REPOSITÓRIO"

REPO_URL="https://${GITHUB_ACTOR}:${GH_PAT}@github.com/${REPO_FULL_NAME}.git"
TARGET_REF="${DEPLOY_VERSION:-main}"

log_info "Deploy da versão: ${TARGET_REF}"

cd /opt/alice

if [ -d "app/.git" ]; then
    cd app
    git remote set-url origin "${REPO_URL}" || log_error "Falha ao setar remote origin"
    
    log_info "Limpando mudanças locais (versionamento automático do deploy anterior)..."
    git reset --hard HEAD || log_error "Falha ao fazer git reset --hard HEAD"
    git clean -fd || log_error "Falha ao fazer git clean -fd"
    
    git fetch origin --tags || log_error "Falha ao fazer git fetch origin"
    
    if [[ "${TARGET_REF}" == v* ]]; then
        log_info "Checkout da TAG: ${TARGET_REF}"
        git checkout "tags/${TARGET_REF}" || log_error "Falha ao fazer git checkout tags/${TARGET_REF}"
    else
        log_info "Checkout da branch: ${TARGET_REF}"
        git checkout "${TARGET_REF}" || log_error "Falha ao fazer git checkout ${TARGET_REF}"
        git reset --hard "origin/${TARGET_REF}" || log_error "Falha ao fazer git reset --hard origin/${TARGET_REF}"
    fi
    
    git remote set-url origin "https://github.com/${REPO_FULL_NAME}.git" || log_error "Falha ao restaurar remote HTTPS"
    cd ..
else
    rm -rf app
    git clone "${REPO_URL}" app || log_error "Falha ao clonar repositório ${REPO_FULL_NAME}"
    cd app
    git remote set-url origin "https://github.com/${REPO_FULL_NAME}.git" || log_error "Falha ao ajustar remote HTTPS pós-clone"
    
    if [[ "${TARGET_REF}" == v* ]]; then
        log_info "Checkout da TAG após clone: ${TARGET_REF}"
        git fetch origin --tags || log_error "Falha ao fazer git fetch tags"
        git checkout "tags/${TARGET_REF}" || log_error "Falha ao fazer git checkout tags/${TARGET_REF}"
    elif [ "${TARGET_REF}" != "main" ]; then
        log_info "Checkout da branch após clone: ${TARGET_REF}"
        git checkout "${TARGET_REF}" || log_error "Falha ao fazer git checkout ${TARGET_REF}"
    fi
    cd ..
fi

log_info "Código atualizado para: ${TARGET_REF}"

# Validar estrutura
if [ ! -d "/opt/alice/app/infra/docker" ]; then
    log_error "Diretório infra/docker não encontrado após o clone"
fi

cd /opt/alice/app
log_info "Diretório atual: $(pwd)"

# =============================================================================
# ETAPA 8: VALIDAÇÃO PRÉ-DEPLOY
# =============================================================================

log_header "VALIDAÇÃO PRÉ-DEPLOY: VERIFICANDO ARQUIVOS NECESSÁRIOS"

MISSING_FILES=0

# Arquivos de configuração SearXNG
[ ! -f "infra/searxng/settings.yml" ] && { log_error "infra/searxng/settings.yml não encontrado"; MISSING_FILES=$((MISSING_FILES + 1)); } || log_info "✓ infra/searxng/settings.yml"
[ ! -f "infra/searxng/limiter.toml" ] && { log_error "infra/searxng/limiter.toml não encontrado"; MISSING_FILES=$((MISSING_FILES + 1)); } || log_info "✓ infra/searxng/limiter.toml"

# Migrações críticas
CRITICAL_MIGRATIONS=(
    "migrations/0003_update_embedding_dimensions_768.sql"
    "migrations/0005_update_embedding_dimensions_1024.sql"
)

for migration in "${CRITICAL_MIGRATIONS[@]}"; do
    if [ ! -f "$migration" ]; then
        log_error "Migration crítica não encontrada: $migration"
        MISSING_FILES=$((MISSING_FILES + 1))
    else
        log_info "✓ $migration"
    fi
done

# Verificar docker-compose.prod.yml
[ ! -f "infra/docker/docker-compose.prod.yml" ] && { log_error "infra/docker/docker-compose.prod.yml não encontrado"; MISSING_FILES=$((MISSING_FILES + 1)); } || log_info "✓ infra/docker/docker-compose.prod.yml"

if [ "$MISSING_FILES" -gt 0 ]; then
    log_error "$MISSING_FILES arquivo(s) obrigatório(s) não encontrado(s)"
fi

log_info "Todos os arquivos necessários foram encontrados"

# =============================================================================
# ETAPA 9: MOVER .env.prod (se veio via SCP)
# =============================================================================

if [ -f /tmp/.env.prod ]; then
    mv /tmp/.env.prod infra/docker/.env.prod
    chmod 600 infra/docker/.env.prod
    log_info ".env.prod movido para infra/docker/.env.prod"
else
    log_warn ".env.prod não encontrado em /tmp (pode ser normal em self-hosted runner - será gerado)"
fi

# =============================================================================
# ETAPA 10: LOGIN NO DOCKER REGISTRIES
# =============================================================================

log_header "LOGIN NO DOCKER REGISTRIES"

# Login no Docker Hub (para imagens de terceiros - evita rate limit)
if [ -n "${DOCKERHUB_USERNAME:-}" ] && [ -n "${DOCKERHUB_TOKEN:-}" ]; then
    echo "${DOCKERHUB_TOKEN}" | docker login -u "${DOCKERHUB_USERNAME}" --password-stdin || log_warn "Docker Hub login falhou (continuando com rate limit anônimo)"
else
    log_warn "DOCKERHUB_USERNAME/DOCKERHUB_TOKEN não configurados (usando rate limit anônimo)"
fi

# Login no GHCR
echo "${GH_PAT}" | docker login ghcr.io -u "${GITHUB_ACTOR}" --password-stdin || log_error "Falha no docker login (GHCR)"

log_info "Login nos registries concluído"

# =============================================================================
# ETAPA 11: VERSIONAMENTO AUTOMÁTICO
# =============================================================================

log_header "ATUALIZANDO docker-compose.prod.yml COM VERSÕES E DIGESTS"

cd /opt/alice/app/infra/docker

if [ -f "docker-compose.prod.yml" ] && command -v python3 &> /dev/null; then
    cd /opt/alice/app
    
    # Construir comando python3 com todas as versões
    PYTHON_CMD="python3 scripts/update-component-versions.py"
    
    # Adicionar parâmetros de versão (se definidos)
    [ -n "${TRAEFIK_VERSION:-}" ] && PYTHON_CMD="$PYTHON_CMD --traefik-version ${TRAEFIK_VERSION}"
    [ -n "${TRAEFIK_DIGEST:-}" ] && PYTHON_CMD="$PYTHON_CMD --traefik-digest ${TRAEFIK_DIGEST}"
    [ -n "${PROMETHEUS_VERSION:-}" ] && PYTHON_CMD="$PYTHON_CMD --prometheus-version ${PROMETHEUS_VERSION}"
    [ -n "${PROMETHEUS_DIGEST:-}" ] && PYTHON_CMD="$PYTHON_CMD --prometheus-digest ${PROMETHEUS_DIGEST}"
    [ -n "${GRAFANA_VERSION:-}" ] && PYTHON_CMD="$PYTHON_CMD --grafana-version ${GRAFANA_VERSION}"
    [ -n "${GRAFANA_DIGEST:-}" ] && PYTHON_CMD="$PYTHON_CMD --grafana-digest ${GRAFANA_DIGEST}"
    [ -n "${LOKI_VERSION:-}" ] && PYTHON_CMD="$PYTHON_CMD --loki-version ${LOKI_VERSION}"
    [ -n "${LOKI_DIGEST:-}" ] && PYTHON_CMD="$PYTHON_CMD --loki-digest ${LOKI_DIGEST}"
    [ -n "${PROMTAIL_VERSION:-}" ] && PYTHON_CMD="$PYTHON_CMD --promtail-version ${PROMTAIL_VERSION}"
    [ -n "${PROMTAIL_DIGEST:-}" ] && PYTHON_CMD="$PYTHON_CMD --promtail-digest ${PROMTAIL_DIGEST}"
    [ -n "${JAEGER_VERSION:-}" ] && PYTHON_CMD="$PYTHON_CMD --jaeger-version ${JAEGER_VERSION}"
    [ -n "${JAEGER_DIGEST:-}" ] && PYTHON_CMD="$PYTHON_CMD --jaeger-digest ${JAEGER_DIGEST}"
    [ -n "${LANGFUSE_VERSION:-}" ] && PYTHON_CMD="$PYTHON_CMD --langfuse-version ${LANGFUSE_VERSION}"
    [ -n "${LANGFUSE_DIGEST:-}" ] && PYTHON_CMD="$PYTHON_CMD --langfuse-digest ${LANGFUSE_DIGEST}"
    [ -n "${ERPNEXT_VERSION:-}" ] && PYTHON_CMD="$PYTHON_CMD --erpnext-version ${ERPNEXT_VERSION}"
    [ -n "${ERPNEXT_DIGEST:-}" ] && PYTHON_CMD="$PYTHON_CMD --erpnext-digest ${ERPNEXT_DIGEST}"
    [ -n "${DOCKER_SOCKET_PROXY_VERSION:-}" ] && PYTHON_CMD="$PYTHON_CMD --docker-socket-proxy-version ${DOCKER_SOCKET_PROXY_VERSION}"
    [ -n "${DOCKER_SOCKET_PROXY_DIGEST:-}" ] && PYTHON_CMD="$PYTHON_CMD --docker-socket-proxy-digest ${DOCKER_SOCKET_PROXY_DIGEST}"
    [ -n "${BUSYBOX_VERSION:-}" ] && PYTHON_CMD="$PYTHON_CMD --busybox-version ${BUSYBOX_VERSION}"
    [ -n "${BUSYBOX_DIGEST:-}" ] && PYTHON_CMD="$PYTHON_CMD --busybox-digest ${BUSYBOX_DIGEST}"
    [ -n "${REDIS_VERSION:-}" ] && PYTHON_CMD="$PYTHON_CMD --redis-version ${REDIS_VERSION}"
    [ -n "${REDIS_DIGEST:-}" ] && PYTHON_CMD="$PYTHON_CMD --redis-digest ${REDIS_DIGEST}"
    [ -n "${MARIADB_VERSION:-}" ] && PYTHON_CMD="$PYTHON_CMD --mariadb-version ${MARIADB_VERSION}"
    [ -n "${MARIADB_DIGEST:-}" ] && PYTHON_CMD="$PYTHON_CMD --mariadb-digest ${MARIADB_DIGEST}"
    [ -n "${PGVECTOR_TAG:-}" ] && PYTHON_CMD="$PYTHON_CMD --pgvector-tag ${PGVECTOR_TAG}"
    [ -n "${PGVECTOR_DIGEST:-}" ] && PYTHON_CMD="$PYTHON_CMD --pgvector-digest ${PGVECTOR_DIGEST}"
    
    PYTHON_CMD="$PYTHON_CMD --compose-file infra/docker/docker-compose.prod.yml"
    
    eval "$PYTHON_CMD" || {
        log_error "Falha ao atualizar docker-compose.prod.yml - versionamento automático é obrigatório"
    }
else
    log_warn "docker-compose.prod.yml não encontrado ou python3 não disponível - usando versões do .env.prod"
fi

cd /opt/alice/app

# =============================================================================
# ETAPA 12: VALIDAÇÃO CRÍTICA .env.prod
# =============================================================================

if [ ! -f "infra/docker/.env.prod" ]; then
    log_error ".env.prod não encontrado em infra/docker/"
fi

log_info ".env.prod validado em /opt/alice/app/infra/docker/.env.prod"

# =============================================================================
# ETAPA 13: SETUP REDES DOCKER
# =============================================================================

log_header "CONFIGURANDO REDES DOCKER"

if ! docker network inspect alice-network &> /dev/null; then
    docker network create --driver bridge --subnet 172.28.0.0/16 alice-network
fi

if ! docker network inspect erpnext-network &> /dev/null; then
    docker network create --driver bridge erpnext-network
fi

log_info "Redes Docker configuradas"

# =============================================================================
# ETAPA 14: PRÉ-DEPLOY - LIMPEZA COMPLETA
# =============================================================================

log_header "PRÉ-DEPLOY: LIMPEZA COMPLETA"

log_info "[1/5] Parando containers existentes..."
docker ps -aq --filter "name=alice-" | xargs -r docker stop 2>/dev/null || true
docker ps -aq --filter "name=erpnext-" | xargs -r docker stop 2>/dev/null || true

log_info "[2/5] Removendo containers..."
docker ps -aq --filter "name=alice-" | xargs -r docker rm -f 2>/dev/null || true
docker ps -aq --filter "name=erpnext-" | xargs -r docker rm -f 2>/dev/null || true

log_info "[3/5] Limpando recursos órfãos..."
docker container prune -f 2>/dev/null || true
docker image prune -f 2>/dev/null || true
docker builder prune -f 2>/dev/null || true

log_info "[4/5] Limpando volumes órfãos..."
docker volume prune -f 2>/dev/null || true

log_info "[5/5] Verificando limpeza..."
REMAINING_ALICE=$(docker ps -aq --filter "name=alice-" | wc -l)
REMAINING_ERPNEXT=$(docker ps -aq --filter "name=erpnext-" | wc -l)
REMAINING=$((REMAINING_ALICE + REMAINING_ERPNEXT))

if [ "$REMAINING" -gt 0 ]; then
    log_warn "$REMAINING containers ainda existem, forçando remoção..."
    docker ps -aq --filter "name=alice-" | xargs -r docker rm -f 2>/dev/null || true
    docker ps -aq --filter "name=erpnext-" | xargs -r docker rm -f 2>/dev/null || true
fi

log_info "Limpeza completa concluída"

# =============================================================================
# ETAPA 15: MIGRAÇÃO DATABASE
# =============================================================================

log_header "MIGRAÇÃO DATABASE"

log_info "Iniciando PostgreSQL para migração..."
cd /opt/alice/app/infra/docker
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres

# Extrair credenciais do .env.prod
PG_USER=$(grep -E "^POSTGRES_USER=" .env.prod | cut -d'=' -f2- || echo "alice")
PG_PASS=$(grep -E "^POSTGRES_PASSWORD=" .env.prod | cut -d'=' -f2-)
PG_DB=$(grep -E "^POSTGRES_DB=" .env.prod | cut -d'=' -f2- || echo "alice_prod")

PG_USER="${PG_USER:-alice}"
PG_DB="${PG_DB:-alice_prod}"

if [ -z "${PG_PASS}" ]; then
    log_error "POSTGRES_PASSWORD não encontrado no .env.prod"
fi

# Aguardar PostgreSQL (com segurança via env file)
log_info "Aguardando PostgreSQL ficar pronto..."
OLD_UMASK=$(umask)
umask 077
PG_READY_ENV_FILE=$(mktemp)
umask "$OLD_UMASK"
printf "PGUSER=%s\n" "${PG_USER}" > "$PG_READY_ENV_FILE"
printf "PGDATABASE=%s\n" "${PG_DB}" >> "$PG_READY_ENV_FILE"
chmod 600 "$PG_READY_ENV_FILE"

PG_READY=false
for i in {1..30}; do
    if docker run --rm --network alice-network \
        --env-file "$PG_READY_ENV_FILE" \
        postgres:16-alpine \
        sh -c "apk add --no-cache postgresql-client >/dev/null 2>&1 && pg_isready -h alice-postgres" >/dev/null 2>&1; then
        log_info "PostgreSQL está pronto!"
        PG_READY=true
        break
    fi
    sleep 2
done

rm -f "$PG_READY_ENV_FILE"

if [ "$PG_READY" = "false" ]; then
    log_error "PostgreSQL não está pronto após 60s"
fi

# Função URL-encoding para DATABASE_URL
urlencode() {
    local string="${1}"
    local strlen=${#string}
    local encoded=""
    local pos c hex ascii
    
    for (( pos=0 ; pos<strlen ; pos++ )); do
        c=${string:$pos:1}
        case "$c" in
            [_.~a-zA-Z0-9-] )
                encoded+="${c}"
                ;;
            * )
                LC_ALL=C printf -v ascii '%d' "'$c"
                printf -v hex '%%%02X' "$ascii"
                encoded+="${hex}"
                ;;
        esac
    done
    echo -n "${encoded}"
}

# Construir DATABASE_URL com URL-encoding
PG_USER_ENCODED=$(urlencode "${PG_USER}")
PG_PASS_ENCODED=$(urlencode "${PG_PASS}")
PG_DB_ENCODED=$(urlencode "${PG_DB}")
DB_URL="postgresql://${PG_USER_ENCODED}:${PG_PASS_ENCODED}@alice-postgres:5432/${PG_DB_ENCODED}?sslmode=disable"

log_info "DATABASE_URL construído: postgresql://${PG_USER}:***@alice-postgres:5432/${PG_DB}?sslmode=disable"

# Validar conexão PostgreSQL
log_info "Validando conexão PostgreSQL antes de drizzle-kit push..."
OLD_UMASK=$(umask)
umask 077
VALIDATION_ENV_FILE=$(mktemp)
umask "$OLD_UMASK"
printf "PGPASSWORD=%s\n" "${PG_PASS}" > "$VALIDATION_ENV_FILE"
printf "PG_USER=%s\n" "${PG_USER}" >> "$VALIDATION_ENV_FILE"
printf "PG_DB=%s\n" "${PG_DB}" >> "$VALIDATION_ENV_FILE"
chmod 600 "$VALIDATION_ENV_FILE"

docker run --rm \
    --network alice-network \
    --env-file "$VALIDATION_ENV_FILE" \
    postgres:16-alpine \
    sh -c "
        apk add --no-cache postgresql-client >/dev/null 2>&1 && \
        for i in \$(seq 1 30); do
            if psql -h alice-postgres -U \"\$PG_USER\" -d \"\$PG_DB\" -c 'SELECT 1' >/dev/null 2>&1; then
                echo 'Conexão PostgreSQL validada com sucesso'
                exit 0
            fi
            sleep 2
        done
        echo 'ERRO: Não foi possível conectar ao PostgreSQL após 60s'
        exit 1
    " || {
        log_error "Validação de conexão PostgreSQL falhou"
        rm -f "$VALIDATION_ENV_FILE"
        exit 1
    }
rm -f "$VALIDATION_ENV_FILE"

# Criar extensão pgvector ANTES do drizzle-kit push
log_info "Criando extensão pgvector (obrigatória para halfvec/vector types)..."
OLD_UMASK=$(umask)
umask 077
EXTENSION_ENV_FILE=$(mktemp)
umask "$OLD_UMASK"
printf "PGPASSWORD=%s\n" "${PG_PASS}" > "$EXTENSION_ENV_FILE"
printf "PG_USER=%s\n" "${PG_USER}" >> "$EXTENSION_ENV_FILE"
printf "PG_DB=%s\n" "${PG_DB}" >> "$EXTENSION_ENV_FILE"
chmod 600 "$EXTENSION_ENV_FILE"

docker run --rm \
    --network alice-network \
    --env-file "$EXTENSION_ENV_FILE" \
    pgvector/pgvector:pg16@sha256:ba936058427f638177f216901afc42cbacac0c4e1f441adf9c39a4a777d31075 \
    sh -c "
        psql -h alice-postgres -U \"\$PG_USER\" -d \"\$PG_DB\" -c 'CREATE EXTENSION IF NOT EXISTS vector;' || {
            echo 'ERRO: Falha ao criar extensão vector'
            exit 1
        }
        echo '✅ Extensão pgvector criada com sucesso'
    " || {
        log_error "Falha ao criar extensão pgvector"
        rm -f "$EXTENSION_ENV_FILE"
        exit 1
    }
rm -f "$EXTENSION_ENV_FILE"

# Executar drizzle-kit push
log_info "Executando drizzle-kit push com timeout de 300s..."
DRIZZLE_TIMEOUT=300

OLD_UMASK=$(umask)
umask 077
DRIZZLE_ENV_FILE=$(mktemp)
umask "$OLD_UMASK"
printf "DATABASE_URL=%s\n" "${DB_URL}" > "$DRIZZLE_ENV_FILE"
printf "DRIZZLE_TIMEOUT=%s\n" "${DRIZZLE_TIMEOUT}" >> "$DRIZZLE_ENV_FILE"
chmod 600 "$DRIZZLE_ENV_FILE"

docker run --rm \
    --network alice-network \
    -v /opt/alice/app:/app \
    -w /app \
    --env-file "$DRIZZLE_ENV_FILE" \
    node:22-alpine \
    sh -c "
        echo 'Instalando drizzle-kit...'
        npm install -g pnpm@10 && \
        pnpm install --frozen-lockfile --ignore-scripts && \
        echo \"Executando drizzle-kit push (timeout: \${DRIZZLE_TIMEOUT}s)...\" && \
        timeout \${DRIZZLE_TIMEOUT} npx drizzle-kit push --force
        TIMEOUT_EXIT_CODE=\$?
        if [ \$TIMEOUT_EXIT_CODE -eq 0 ]; then
            echo \"✅ drizzle-kit push concluído com sucesso\"
            exit 0
        elif [ \$TIMEOUT_EXIT_CODE -eq 124 ]; then
            echo \"❌ ERRO: drizzle-kit push excedeu timeout de \${DRIZZLE_TIMEOUT}s\"
            exit 124
        else
            echo \"❌ ERRO: drizzle-kit push falhou com exit code \$TIMEOUT_EXIT_CODE\"
            exit \$TIMEOUT_EXIT_CODE
        fi
    " || {
        DRIZZLE_EXIT_CODE=$?
        if [ "$DRIZZLE_EXIT_CODE" -eq 124 ]; then
            log_error "drizzle-kit push excedeu timeout de 300s"
        else
            log_error "drizzle-kit push falhou (exit code: $DRIZZLE_EXIT_CODE)"
        fi
        rm -f "$DRIZZLE_ENV_FILE"
        exit "$DRIZZLE_EXIT_CODE"
    }

rm -f "$DRIZZLE_ENV_FILE"
log_info "Schema base processado"

# Executar migrations SQL
log_info "Executando migrações do banco de dados (idempotentes)..."

# Função helper para migrations idempotentes
run_migration_idempotent() {
    local migration_file="$1"
    local migration_name="$2"
    
    if [ -f "$migration_file" ]; then
        log_info "  → Executando $migration_name..."
        OLD_UMASK=$(umask)
        umask 077
        MIGRATION_ENV_FILE=$(mktemp)
        umask "$OLD_UMASK"
        printf "PGPASSWORD=%s\n" "${PG_PASS}" > "$MIGRATION_ENV_FILE"
        printf "PG_USER=%s\n" "${PG_USER}" >> "$MIGRATION_ENV_FILE"
        printf "PG_DB=%s\n" "${PG_DB}" >> "$MIGRATION_ENV_FILE"
        chmod 600 "$MIGRATION_ENV_FILE"
        
        local MIGRATION_ABSOLUTE_PATH="$(cd "$(dirname "$migration_file")" && pwd)/$(basename "$migration_file")"
        local MIGRATION_CONTAINER_PATH="/tmp/$(basename "$migration_file")"
        docker run --rm \
            --network alice-network \
            --env-file "$MIGRATION_ENV_FILE" \
            -e "MIGRATION_CONTAINER_PATH=$MIGRATION_CONTAINER_PATH" \
            -v "$MIGRATION_ABSOLUTE_PATH:$MIGRATION_CONTAINER_PATH:ro" \
            postgres:16-alpine \
            sh -c "apk add --no-cache postgresql-client >/dev/null 2>&1 && psql -h alice-postgres -U \"\$PG_USER\" -d \"\$PG_DB\" -v ON_ERROR_STOP=0 -f \"\$MIGRATION_CONTAINER_PATH\"" 2>&1 | grep -v "already exists" | grep -v "NOTICE:" || true
        
        rm -f "$MIGRATION_ENV_FILE"
        log_info "  ✓ $migration_name aplicada"
    else
        log_warn "  ⚠️ $migration_name não encontrada (pode ser normal em primeiro deploy)"
    fi
}

# Função helper para migrations críticas
run_migration_critical() {
    local migration_file="$1"
    local migration_name="$2"
    local psql_exit_code=0
    local psql_output=""
    
    if [ ! -f "$migration_file" ]; then
        log_error "$migration_name não encontrada! Esta migration é OBRIGATÓRIA."
    fi
    
    log_info "  → Executando $migration_name (CRÍTICA)..."
    
    OLD_UMASK=$(umask)
    umask 077
    MIGRATION_ENV_FILE=$(mktemp)
    umask "$OLD_UMASK"
    printf "PGPASSWORD=%s\n" "${PG_PASS}" > "$MIGRATION_ENV_FILE"
    printf "PG_USER=%s\n" "${PG_USER}" >> "$MIGRATION_ENV_FILE"
    printf "PG_DB=%s\n" "${PG_DB}" >> "$MIGRATION_ENV_FILE"
    chmod 600 "$MIGRATION_ENV_FILE"
    
    local MIGRATION_ABSOLUTE_PATH="$(cd "$(dirname "$migration_file")" && pwd)/$(basename "$migration_file")"
    local MIGRATION_CONTAINER_PATH="/tmp/$(basename "$migration_file")"
    
    psql_output=$(
        docker run --rm \
            --network alice-network \
            --env-file "$MIGRATION_ENV_FILE" \
            -e "MIGRATION_CONTAINER_PATH=$MIGRATION_CONTAINER_PATH" \
            -v "$MIGRATION_ABSOLUTE_PATH:$MIGRATION_CONTAINER_PATH:ro" \
            postgres:16-alpine \
            sh -c "apk add --no-cache postgresql-client >/dev/null 2>&1 && psql -h alice-postgres -U \"\$PG_USER\" -d \"\$PG_DB\" -v ON_ERROR_STOP=1 -f \"\$MIGRATION_CONTAINER_PATH\"" 2>&1
    ) || psql_exit_code=$?
    
    rm -f "$MIGRATION_ENV_FILE"
    
    echo "$psql_output" | grep -v "NOTICE:" || true
    
    if [ "$psql_exit_code" -ne 0 ]; then
        log_error "Falha na execução de $migration_name (exit code: $psql_exit_code)"
    fi
    
    log_info "  ✓ $migration_name aplicada (CRÍTICA)"
}

# Executar migrations
cd /opt/alice/app/infra/docker
run_migration_idempotent "../../migrations/0001_rls_security_enterprise.sql" "0001_rls_security_enterprise"
run_migration_idempotent "../../migrations/0002_create_feature_flags.sql" "0002_create_feature_flags"
run_migration_critical "../../migrations/0003_update_embedding_dimensions_768.sql" "0003_update_embedding_dimensions_768"
run_migration_idempotent "../../migrations/0004_multimodal_learning_and_crawler.sql" "0004_multimodal_learning_and_crawler"
run_migration_critical "../../migrations/0005_update_embedding_dimensions_1024.sql" "0005_update_embedding_dimensions_1024"

log_info "Todas as migrações processadas"

# =============================================================================
# ETAPA 15.5: LIMPEZA DE VOLUMES ÓRFÃOS
# =============================================================================

log_header "PRÉ-DEPLOY: LIMPEZA DE VOLUMES DOCKER ÓRFÃOS"

BIND_MOUNT_VOLUMES=(
    "erpnext-sites"
    "erpnext-logs"
    "erpnext-mariadb"
    "erpnext-redis-cache"
    "erpnext-redis-queue"
    "alice-postgres-data"
    "alice-redis-data"
    "alice-traefik-acme"
    "alice-searxng-config"
    "alice-qdrant-data"
    "alice-vector-data"
    "alice-alertmanager-data"
    "alice-clickhouse-data"
    "alice-clickhouse-logs"
    "alice-langfuse-db-data"
)

log_info "Verificando volumes Docker órfãos que conflitam com bind mounts..."
for vol in "${BIND_MOUNT_VOLUMES[@]}"; do
    if docker volume ls -q | grep -q "^${vol}$"; then
        log_warn "Encontrado volume órfão: $vol"
        docker volume rm "$vol" 2>/dev/null || {
            log_warn "Volume em uso, tentando forçar..."
            docker ps -aq --filter "volume=$vol" | xargs -r docker stop 2>/dev/null || true
            docker ps -aq --filter "volume=$vol" | xargs -r docker rm 2>/dev/null || true
            docker volume rm "$vol" 2>/dev/null || log_warn "Não foi possível remover $vol"
        }
    fi
done

# Verificar conflitos arquivo/diretório
log_info "Verificando conflitos arquivo/diretório nos bind mounts..."
for dir in /opt/alice/data/erpnext-sites /opt/alice/logs/erpnext; do
    if { [ -e "$dir" ] || [ -L "$dir" ]; } && [ ! -d "$dir" ]; then
        log_warn "Conflito: $dir existe como arquivo/symlink, renomeando..."
        mv "$dir" "${dir}.bak.$(date +%s)"
        mkdir -p "$dir"
        chown -R 1000:1000 "$dir"
        chmod -R 755 "$dir"
    fi
    
    if [ -d "$dir" ]; then
        assets_path="$dir/assets"
        if { [ -e "$assets_path" ] || [ -L "$assets_path" ]; } && [ ! -d "$assets_path" ]; then
            log_warn "Conflito: $assets_path existe como arquivo/symlink, renomeando..."
            mv "$assets_path" "${assets_path}.bak.$(date +%s)"
            mkdir -p "$assets_path"
            chown -R 1000:1000 "$assets_path"
            chmod -R 755 "$assets_path"
        fi
    fi
done

docker volume prune -f 2>/dev/null || true
log_info "Limpeza de volumes concluída"

# =============================================================================
# ETAPA 16: DEPLOY DOS CONTAINERS EM FASES
# =============================================================================

log_header "DEPLOY DOS CONTAINERS EM FASES SEQUENCIAIS"

cd /opt/alice/app/infra/docker

# Validação do docker-compose.prod.yml
log_info "Validando docker-compose.prod.yml..."
docker compose -f docker-compose.prod.yml --env-file .env.prod config --quiet || log_error "docker-compose.prod.yml inválido!"

# Timeouts por fase
PHASE2_TIMEOUT=240
PHASE3_TIMEOUT=120
PHASE4_TIMEOUT=300
PHASE5_TIMEOUT=120
PHASE6_TIMEOUT=300
PHASE7_TIMEOUT=600
CONFIGURATOR_TIMEOUT=180
CREATE_SITE_TIMEOUT=1200

# Determinar quais fases executar
DEPLOY_ALICE="false"
DEPLOY_ERPNEXT="false"
DEPLOY_OBSERVABILITY="false"

case "${DEPLOY_SERVICES:-all}" in
    "alice-only")
        DEPLOY_ALICE="true"
        DEPLOY_OBSERVABILITY="true"
        log_info "Modo: Alice Stack apenas (fases 1-4, 7)"
        ;;
    "erpnext-only")
        DEPLOY_ERPNEXT="true"
        log_info "Modo: ERPNext Stack apenas (fases 5-6)"
        ;;
    *)
        DEPLOY_ALICE="true"
        DEPLOY_ERPNEXT="true"
        DEPLOY_OBSERVABILITY="true"
        log_info "Modo: Stack Completa (todas as 7 fases)"
        ;;
esac

DEPLOY_EXIT_CODE=0

# FASE 1: Pull de imagens
log_info "FASE 1: Pull de imagens..."
docker compose -f docker-compose.prod.yml --env-file .env.prod pull --ignore-pull-failures || true
log_info "Pull concluído"

# FASES 2-4: Alice Stack
if [ "$DEPLOY_ALICE" = "true" ]; then
    cd /opt/alice/app
    
    # FASE 2: Infraestrutura base Alice
    log_info "FASE 2: Infraestrutura base (postgres, redis, qdrant, tor, searxng) [timeout: ${PHASE2_TIMEOUT}s]..."
    
    log_info "Configurando SearXNG com Tor proxy e bot detection..."
    mkdir -p /opt/alice/data/searxng-config
    
    SEARXNG_SETTINGS="infra/searxng/settings.yml"
    SEARXNG_LIMITER="infra/searxng/limiter.toml"
    
    if [ ! -f "$SEARXNG_SETTINGS" ] || [ ! -f "$SEARXNG_LIMITER" ]; then
        log_error "Arquivos de configuração SearXNG não encontrados"
    fi
    
    cp "$SEARXNG_SETTINGS" /opt/alice/data/searxng-config/settings.yml
    cp "$SEARXNG_LIMITER" /opt/alice/data/searxng-config/limiter.toml
    chown 977:977 /opt/alice/data/searxng-config/{settings.yml,limiter.toml}
    chmod 644 /opt/alice/data/searxng-config/{settings.yml,limiter.toml}
    
    cd infra/docker
    docker compose -f docker-compose.prod.yml --env-file .env.prod \
        up -d --no-build --remove-orphans --wait --wait-timeout $PHASE2_TIMEOUT \
        postgres alice-redis alice-qdrant alice-tor alice-searxng || { DEPLOY_EXIT_CODE=$?; log_error "FASE 2 falhou"; }
    
    if [ "$DEPLOY_EXIT_CODE" -eq 0 ]; then
        log_info "Infraestrutura base healthy"
        
        # FASE 3: Gateway
        log_info "FASE 3: Gateway (dockerproxy, traefik) [timeout: ${PHASE3_TIMEOUT}s]..."
        docker compose -f docker-compose.prod.yml --env-file .env.prod \
            up -d --no-build --wait --wait-timeout $PHASE3_TIMEOUT \
            dockerproxy traefik-init traefik || { DEPLOY_EXIT_CODE=$?; log_error "FASE 3 falhou"; }
    fi
    
    if [ "$DEPLOY_EXIT_CODE" -eq 0 ]; then
        log_info "Gateway healthy"
        
        # FASE 4: Serviços Alice
        # BUG FIX 28/12/2025: gpu-manager DEVE ser iniciado ANTES dos serviços que dependem dele
        # alice-chat, alice-rag, alice-training têm depends_on: gpu-manager: condition: service_healthy
        # Sem gpu-manager na lista, Docker Compose falhava com "dependency failed to start: container alice-gpu-manager is unhealthy"
        log_info "FASE 4: Serviços Alice (gpu-manager, auth, chat, rag, training, integrations, observability, frontend) [timeout: ${PHASE4_TIMEOUT}s]..."
        docker compose -f docker-compose.prod.yml --env-file .env.prod \
            up -d --no-build --wait --wait-timeout $PHASE4_TIMEOUT \
            gpu-manager alice-auth alice-chat alice-rag alice-training alice-integrations alice-observability alice-frontend || { DEPLOY_EXIT_CODE=$?; log_error "FASE 4 falhou"; }
    fi
    
    if [ "$DEPLOY_EXIT_CODE" -eq 0 ]; then
        log_info "Serviços Alice healthy"
    fi
else
    log_info "FASES 2-4 ignoradas (DEPLOY_SERVICES=${DEPLOY_SERVICES})"
fi

# FASES 5-6: ERPNext Stack
if [ "$DEPLOY_EXIT_CODE" -eq 0 ] && [ "$DEPLOY_ERPNEXT" = "true" ]; then
    cd /opt/alice/app/infra/docker
    
    # FASE 5: Infraestrutura ERPNext
    log_info "FASE 5: Infraestrutura ERPNext (mariadb, redis) [timeout: ${PHASE5_TIMEOUT}s]..."
    docker compose -f docker-compose.prod.yml --env-file .env.prod \
        up -d --no-build --wait --wait-timeout $PHASE5_TIMEOUT \
        erpnext-mariadb erpnext-redis-cache erpnext-redis-queue || { DEPLOY_EXIT_CODE=$?; log_error "FASE 5 falhou"; }
    
    if [ "$DEPLOY_EXIT_CODE" -eq 0 ]; then
        log_info "Infraestrutura ERPNext healthy"
        
        # FASE 6: Init e Serviços ERPNext
        log_info "FASE 6: ERPNext (configurator, create-site, backend, workers)..."
        
        # Init: configurator
        docker compose -f docker-compose.prod.yml --env-file .env.prod \
            up -d --no-build erpnext-configurator || { DEPLOY_EXIT_CODE=$?; log_error "FASE 6a falhou (configurator)"; }
        
        if [ "$DEPLOY_EXIT_CODE" -eq 0 ]; then
            log_info "Aguardando erpnext-configurator [timeout: ${CONFIGURATOR_TIMEOUT}s]..."
            timeout $CONFIGURATOR_TIMEOUT docker wait erpnext-configurator || true
            
            CONFIGURATOR_STATUS=$(docker inspect erpnext-configurator --format '{{.State.Status}}' 2>/dev/null || echo "unknown")
            if [ "$CONFIGURATOR_STATUS" != "exited" ]; then
                log_error "erpnext-configurator não terminou (status: $CONFIGURATOR_STATUS)"
            else
                CONFIGURATOR_EXIT=$(docker inspect erpnext-configurator --format '{{.State.ExitCode}}' 2>/dev/null || echo "1")
                if [ "$CONFIGURATOR_EXIT" != "0" ]; then
                    log_error "erpnext-configurator falhou com exit code: $CONFIGURATOR_EXIT"
                else
                    log_info "erpnext-configurator completou com sucesso"
                fi
            fi
        fi
        
        # Init: create-site
        if [ "$DEPLOY_EXIT_CODE" -eq 0 ]; then
            docker compose -f docker-compose.prod.yml --env-file .env.prod \
                up -d --no-build erpnext-create-site || { DEPLOY_EXIT_CODE=$?; log_error "FASE 6b falhou (create-site)"; }
            
            if [ "$DEPLOY_EXIT_CODE" -eq 0 ]; then
                log_info "Aguardando erpnext-create-site [timeout: ${CREATE_SITE_TIMEOUT}s]..."
                timeout $CREATE_SITE_TIMEOUT docker wait erpnext-create-site || true
                
                CREATE_SITE_STATUS=$(docker inspect erpnext-create-site --format '{{.State.Status}}' 2>/dev/null || echo "unknown")
                if [ "$CREATE_SITE_STATUS" != "exited" ]; then
                    log_error "erpnext-create-site não terminou (status: $CREATE_SITE_STATUS)"
                else
                    CREATE_SITE_EXIT=$(docker inspect erpnext-create-site --format '{{.State.ExitCode}}' 2>/dev/null || echo "1")
                    if [ "$CREATE_SITE_EXIT" != "0" ]; then
                        log_error "erpnext-create-site falhou com exit code: $CREATE_SITE_EXIT"
                        docker logs erpnext-create-site 2>&1 | tail -200
                    else
                        log_info "erpnext-create-site completou com sucesso"
                    fi
                fi
            fi
        fi
        
        # Serviços ERPNext
        if [ "$DEPLOY_EXIT_CODE" -eq 0 ]; then
            log_info "Iniciando serviços ERPNext [timeout: ${PHASE6_TIMEOUT}s]..."
            docker compose -f docker-compose.prod.yml --env-file .env.prod \
                up -d --no-build --wait --wait-timeout $PHASE6_TIMEOUT \
                erpnext-backend erpnext-frontend erpnext-websocket \
                erpnext-scheduler erpnext-worker-short erpnext-worker-default erpnext-worker-long \
                erpnext-worker-short-2 erpnext-worker-default-2 erpnext-worker-long-2 || { DEPLOY_EXIT_CODE=$?; log_error "FASE 6c falhou (serviços)"; }
        fi
    fi
    
    if [ "$DEPLOY_EXIT_CODE" -eq 0 ]; then
        log_info "ERPNext healthy"
    fi
elif [ "$DEPLOY_ERPNEXT" = "false" ]; then
    log_info "FASES 5-6 ignoradas (DEPLOY_SERVICES=${DEPLOY_SERVICES})"
fi

# FASE 7: Observability Stack
if [ "$DEPLOY_EXIT_CODE" -eq 0 ] && [ "$DEPLOY_OBSERVABILITY" = "true" ]; then
    cd /opt/alice/app/infra/docker
    
    log_info "FASE 7: Observability (prometheus, grafana, langfuse, etc.) [timeout: ${PHASE7_TIMEOUT}s]..."
    docker compose -f docker-compose.prod.yml --env-file .env.prod \
        up -d --no-build --wait --wait-timeout $PHASE7_TIMEOUT \
        clickhouse langfuse langfuse-worker langfuse-db \
        prometheus grafana loki promtail jaeger vector alertmanager otel-collector node-exporter cadvisor \
        pgbackrest || { DEPLOY_EXIT_CODE=$?; log_error "FASE 7 falhou"; }
    
    if [ "$DEPLOY_EXIT_CODE" -eq 0 ]; then
        log_info "Observability healthy"
    fi
elif [ "$DEPLOY_OBSERVABILITY" = "false" ]; then
    log_info "FASE 7 ignorada (DEPLOY_SERVICES=${DEPLOY_SERVICES})"
fi

# Captura de logs se deploy falhou
if [ "${DEPLOY_EXIT_CODE:-0}" -ne 0 ]; then
    log_error "DEPLOY FALHOU (exit code: $DEPLOY_EXIT_CODE)"
    log_info "Capturando logs dos containers problemáticos..."
    
    # Prioridade: erpnext-create-site
    if docker ps -a --format "{{.Names}}" | grep -q "^erpnext-create-site$"; then
        log_info "LOGS DO ERPNEXT-CREATE-SITE:"
        docker logs erpnext-create-site 2>&1 | tail -200
    fi
    
    # Outros containers
    ALICE_CONTAINERS="alice-rag alice-chat alice-auth alice-training alice-integrations alice-frontend alice-observability alice-redis alice-qdrant alice-tor alice-searxng alice-postgres alice-traefik"
    ERPNEXT_CONTAINERS="erpnext-mariadb erpnext-redis-cache erpnext-redis-queue erpnext-configurator erpnext-create-site erpnext-backend erpnext-frontend erpnext-websocket erpnext-scheduler erpnext-worker-short erpnext-worker-default erpnext-worker-long erpnext-worker-short-2 erpnext-worker-default-2 erpnext-worker-long-2"
    
    case "${DEPLOY_SERVICES:-all}" in
        "alice-only")
            CONTAINERS_TO_CHECK="$ALICE_CONTAINERS"
            ;;
        "erpnext-only")
            CONTAINERS_TO_CHECK="$ERPNEXT_CONTAINERS"
            ;;
        *)
            CONTAINERS_TO_CHECK="$ALICE_CONTAINERS $ERPNEXT_CONTAINERS"
            ;;
    esac
    
    for container in $CONTAINERS_TO_CHECK; do
        if docker ps -a --format "{{.Names}}" | grep -q "^${container}$"; then
            log_info "LOGS: $container"
            docker logs --tail 100 "$container" 2>&1 || true
        fi
    done
    
    exit 1
fi

if [ "$DEPLOY_EXIT_CODE" -eq 0 ]; then
    log_info "DEPLOY CONCLUÍDO COM SUCESSO! Modo: ${DEPLOY_SERVICES:-all}"
fi

# =============================================================================
# ETAPA 17: VERIFICAÇÃO PÓS-DEPLOY
# =============================================================================

log_header "PÓS-DEPLOY: STATUS DOS CONTAINERS"

cd /opt/alice/app/infra/docker
docker compose -f docker-compose.prod.yml --env-file .env.prod ps -a

log_info "Verificando saúde dos containers..."

UNHEALTHY_COUNT=$(docker ps -a --filter "health=unhealthy" --format "{{.Names}}" | wc -l)
EXITED_COUNT=$(docker ps -a --filter "status=exited" --filter "name=alice-" --format "{{.Names}}" | grep -v "traefik-init" | wc -l)

log_info "Containers unhealthy: $UNHEALTHY_COUNT"
log_info "Containers Alice crashados: $EXITED_COUNT"

if [ "${DEPLOY_EXIT_CODE:-0}" -ne 0 ]; then
    log_error "docker compose up falhou (exit code: $DEPLOY_EXIT_CODE)"
    docker ps -a --filter "health=unhealthy" --format "{{.Names}}" | while read container; do
        log_info "LOGS: $container"
        docker logs --tail 50 "$container" 2>&1 || true
    done
    exit 1
fi

if [ "$UNHEALTHY_COUNT" -gt 0 ]; then
    log_error "$UNHEALTHY_COUNT container(s) estão unhealthy!"
    docker ps -a --filter "health=unhealthy" --format "{{.Names}}" | while read container; do
        log_info "LOGS: $container"
        docker logs --tail 50 "$container" 2>&1 || true
    done
    exit 1
fi

if [ "$EXITED_COUNT" -gt 0 ]; then
    log_error "$EXITED_COUNT container(s) Alice crasharam!"
    docker ps -a --filter "status=exited" --filter "name=alice-" --format "{{.Names}}" | grep -v "traefik-init" | while read container; do
        log_info "LOGS: $container"
        docker logs --tail 50 "$container" 2>&1 || true
    done
    exit 1
fi

log_info "✅ Deploy concluído com sucesso! Todos os containers estão healthy."

