#!/bin/bash
# =============================================================================
# Script de Verificação/Configuração de Requisitos - Hetzner Server
# =============================================================================
# Descrição: Verifica e configura automaticamente todos os requisitos para
#            a arquitetura 100% GPU Salad Cloud + Hetzner
#
# ARQUITETURA ENTERPRISE (17/12/2025):
# - LLM: Mixtral 8x7B (vLLM AWQ) via Salad Cloud
# - Embeddings: Qwen3-Embedding-8B (4096 dim) + OpenCLIP (1024 dim) via Salad Cloud
# - Vector DB: Qdrant (texto 4096 dim) + PostgreSQL pgvector (imagem 1024 dim)
# - Containers: 43 totais (7 infra + 7 Alice + 15 ERPNext + 13 obs + 1 backup)
#
# Uso: ./verify-hetzner-requirements.sh [--fix] [--verbose]
#   --fix     : Corrige automaticamente problemas encontrados
#   --verbose : Mostra detalhes adicionais
#
# Autor: Fillipe Guerra
# Data: 17 de Dezembro de 2025
# =============================================================================

set -euo pipefail

# =============================================================================
# CONFIGURAÇÕES
# =============================================================================

FIX_MODE=false
VERBOSE=false
ERRORS=0
WARNINGS=0
FIXED=0

# Versões requeridas (enterprise - 2025)
REQUIRED_DOCKER_VERSION="24.0"
REQUIRED_COMPOSE_VERSION="2.20"
REQUIRED_NODE_VERSION="22"
REQUIRED_PYTHON_VERSION="3.11"

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# =============================================================================
# FUNÇÕES AUXILIARES
# =============================================================================

log_header() {
    echo -e "\n${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"
}

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[✓ OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[⚠ WARN]${NC} $1"; ((WARNINGS++)); }
log_error() { echo -e "${RED}[✗ ERROR]${NC} $1"; ((ERRORS++)); }
log_fix() { echo -e "${GREEN}[✓ FIXED]${NC} $1"; ((FIXED++)); }

version_gte() {
    [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

# Parse argumentos
while [[ $# -gt 0 ]]; do
    case $1 in
        --fix|-f) FIX_MODE=true; shift ;;
        --verbose|-v) VERBOSE=true; shift ;;
        *) echo "Uso: $0 [--fix] [--verbose]"; exit 1 ;;
    esac
done

# Verificar root
if [ "$EUID" -ne 0 ]; then
    log_error "Este script precisa ser executado como root"
    exit 1
fi

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║     ALICE ENTERPRISE - VERIFICAÇÃO DE REQUISITOS HETZNER          ║"
echo "║     Arquitetura: 100% GPU Salad Cloud + Hetzner                   ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "Data: $(date '+%Y-%m-%d %H:%M:%S')"
echo "Modo Fix: $FIX_MODE"
echo ""

# =============================================================================
# 1. SISTEMA OPERACIONAL
# =============================================================================
log_header "1. SISTEMA OPERACIONAL"

# Verificar Ubuntu
if [ -f /etc/os-release ]; then
    . /etc/os-release
    log_info "Distribuição: $NAME $VERSION"
    
    if [[ "$ID" == "ubuntu" ]]; then
        log_ok "Ubuntu detectado"
    else
        log_warn "Sistema não é Ubuntu - alguns comandos podem não funcionar"
    fi
else
    log_error "Não foi possível detectar sistema operacional"
fi

# Verificar memória
MEM_TOTAL=$(free -g | awk '/^Mem:/{print $2}')
if [ "$MEM_TOTAL" -ge 16 ]; then
    log_ok "Memória RAM: ${MEM_TOTAL}GB (mínimo: 16GB)"
else
    log_warn "Memória RAM: ${MEM_TOTAL}GB (recomendado: 16GB+)"
fi

# Verificar disco
DISK_FREE=$(df -BG /opt 2>/dev/null | awk 'NR==2{print $4}' | tr -d 'G')
if [ "${DISK_FREE:-0}" -ge 50 ]; then
    log_ok "Espaço em disco /opt: ${DISK_FREE}GB disponível"
else
    log_warn "Espaço em disco /opt: ${DISK_FREE}GB (recomendado: 50GB+)"
fi

# =============================================================================
# 2. DOCKER E COMPOSE
# =============================================================================
log_header "2. DOCKER E COMPOSE"

# Docker
if command -v docker &> /dev/null; then
    DOCKER_VER=$(docker --version | grep -oP '\d+\.\d+' | head -1)
    if version_gte "$DOCKER_VER" "$REQUIRED_DOCKER_VERSION"; then
        log_ok "Docker: $DOCKER_VER (requerido: $REQUIRED_DOCKER_VERSION+)"
    else
        log_warn "Docker: $DOCKER_VER (requerido: $REQUIRED_DOCKER_VERSION+)"
        if $FIX_MODE; then
            log_info "Atualizando Docker..."
            apt-get update -qq
            apt-get install -y docker-ce docker-ce-cli containerd.io
            log_fix "Docker atualizado"
        fi
    fi
else
    log_error "Docker não instalado"
    if $FIX_MODE; then
        log_info "Instalando Docker..."
        curl -fsSL https://get.docker.com | sh
        systemctl enable docker
        systemctl start docker
        log_fix "Docker instalado"
    fi
fi

# Docker Compose
if docker compose version &> /dev/null; then
    COMPOSE_VER=$(docker compose version | grep -oP '\d+\.\d+' | head -1)
    if version_gte "$COMPOSE_VER" "$REQUIRED_COMPOSE_VERSION"; then
        log_ok "Docker Compose: $COMPOSE_VER (requerido: $REQUIRED_COMPOSE_VERSION+)"
    else
        log_warn "Docker Compose: $COMPOSE_VER (requerido: $REQUIRED_COMPOSE_VERSION+)"
    fi
else
    log_error "Docker Compose não instalado"
    if $FIX_MODE; then
        log_info "Docker Compose plugin deve vir com Docker CE"
    fi
fi

# Docker daemon running
if systemctl is-active --quiet docker; then
    log_ok "Docker daemon: running"
else
    log_error "Docker daemon: not running"
    if $FIX_MODE; then
        systemctl start docker
        log_fix "Docker daemon iniciado"
    fi
fi

# =============================================================================
# 3. PACOTES ESSENCIAIS
# =============================================================================
log_header "3. PACOTES ESSENCIAIS"

ESSENTIAL_PACKAGES=(
    "curl"
    "wget"
    "git"
    "htop"
    "jq"
    "unzip"
    "ca-certificates"
    "gnupg"
    "openssl"
    "python3"
    "python3-pip"
)

for pkg in "${ESSENTIAL_PACKAGES[@]}"; do
    if dpkg -l | grep -q "^ii  $pkg "; then
        log_ok "Pacote: $pkg"
    else
        log_warn "Pacote: $pkg não instalado"
        if $FIX_MODE; then
            apt-get update -qq && apt-get install -y "$pkg" >/dev/null 2>&1
            log_fix "Pacote $pkg instalado"
        fi
    fi
done

# Python ruamel.yaml (necessário para deploy)
if python3 -c "import ruamel.yaml" &>/dev/null; then
    log_ok "Python ruamel.yaml: instalado"
else
    log_warn "Python ruamel.yaml: não instalado"
    if $FIX_MODE; then
        apt-get install -y python3-ruamel.yaml 2>/dev/null || \
            PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install ruamel.yaml
        log_fix "ruamel.yaml instalado"
    fi
fi

# =============================================================================
# 4. ESTRUTURA DE DIRETÓRIOS
# =============================================================================
log_header "4. ESTRUTURA DE DIRETÓRIOS"

REQUIRED_DIRS=(
    "/opt/alice"
    "/opt/alice/app"
    "/opt/alice/data"
    "/opt/alice/data/postgres"
    "/opt/alice/data/redis-alice"
    "/opt/alice/data/qdrant"
    "/opt/alice/data/traefik-acme"
    "/opt/alice/data/searxng-config"
    "/opt/alice/data/erpnext-sites"
    "/opt/alice/data/erpnext-mariadb"
    "/opt/alice/data/prometheus"
    "/opt/alice/data/grafana"
    "/opt/alice/data/loki"
    "/opt/alice/data/langfuse-db"
    "/opt/alice/data/alertmanager"
    "/opt/alice/uploads"
    "/opt/alice/uploads/tts"
    "/opt/alice/uploads/media"
    "/opt/alice/backups"
    "/opt/alice/backups/postgresql"
    "/opt/alice/backups/postgresql/logs"
    "/opt/alice/backups/mariadb"
    "/opt/alice/backups/redis"
    "/opt/alice/backups/manifests"
    "/opt/alice/logs"
    "/opt/alice/logs/erpnext"
    "/opt/alice/secrets"
    "/opt/alice/secrets/alertmanager"
)

for dir in "${REQUIRED_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        log_ok "Diretório: $dir"
    else
        log_warn "Diretório: $dir não existe"
        if $FIX_MODE; then
            mkdir -p "$dir"
            chmod 750 "$dir"
            log_fix "Diretório $dir criado"
        fi
    fi
done

# Verificar permissões /opt/alice
if [ -d "/opt/alice" ]; then
    ALICE_PERMS=$(stat -c "%a" /opt/alice)
    if [ "$ALICE_PERMS" == "750" ]; then
        log_ok "Permissões /opt/alice: $ALICE_PERMS"
    else
        log_warn "Permissões /opt/alice: $ALICE_PERMS (esperado: 750)"
        if $FIX_MODE; then
            chmod 750 /opt/alice
            find /opt/alice -type d -exec chmod 750 {} \;
            log_fix "Permissões corrigidas"
        fi
    fi
fi

# Verificar secrets (600)
if [ -d "/opt/alice/secrets" ]; then
    chmod -R 700 /opt/alice/secrets 2>/dev/null || true
    find /opt/alice/secrets -type f -exec chmod 600 {} \; 2>/dev/null || true
    log_ok "Permissões secrets: 700/600"
fi

# =============================================================================
# 5. REDES DOCKER
# =============================================================================
log_header "5. REDES DOCKER"

REQUIRED_NETWORKS=("alice-network" "erpnext-network")

for net in "${REQUIRED_NETWORKS[@]}"; do
    if docker network ls --format '{{.Name}}' | grep -q "^${net}$"; then
        log_ok "Rede Docker: $net"
    else
        log_warn "Rede Docker: $net não existe"
        if $FIX_MODE; then
            docker network create "$net" 2>/dev/null || true
            log_fix "Rede $net criada"
        fi
    fi
done

# =============================================================================
# 6. FIREWALL (UFW)
# =============================================================================
log_header "6. FIREWALL"

if command -v ufw &>/dev/null; then
    if ufw status | grep -q "Status: active"; then
        log_ok "UFW: ativo"
        
        # Verificar portas essenciais
        for port in 22 80 443; do
            if ufw status | grep -q "$port"; then
                log_ok "Porta $port: permitida"
            else
                log_warn "Porta $port: não configurada"
                if $FIX_MODE; then
                    ufw allow $port/tcp
                    log_fix "Porta $port permitida"
                fi
            fi
        done
    else
        log_warn "UFW: inativo"
    fi
else
    log_warn "UFW: não instalado"
fi

# =============================================================================
# 7. VERIFICAÇÃO DE CONECTIVIDADE SALAD CLOUD
# =============================================================================
log_header "7. CONECTIVIDADE SALAD CLOUD (GPUs)"

# API Salad
if curl -s --connect-timeout 5 "https://api.salad.com" > /dev/null 2>&1; then
    log_ok "Salad Cloud API: acessível"
else
    log_warn "Salad Cloud API: não acessível (verificar DNS/firewall)"
fi

# Container Registry (GHCR)
if curl -s --connect-timeout 5 "https://ghcr.io" > /dev/null 2>&1; then
    log_ok "GitHub Container Registry: acessível"
else
    log_warn "GHCR: não acessível"
fi

# =============================================================================
# 8. LIMPEZA DE RECURSOS ÓRFÃOS
# =============================================================================
log_header "8. LIMPEZA DE RECURSOS ÓRFÃOS"

# Containers parados
STOPPED_CONTAINERS=$(docker ps -a --filter "status=exited" -q | wc -l)
if [ "$STOPPED_CONTAINERS" -gt 0 ]; then
    log_warn "Containers parados: $STOPPED_CONTAINERS"
    if $FIX_MODE; then
        docker container prune -f
        log_fix "Containers parados removidos"
    fi
else
    log_ok "Containers parados: 0"
fi

# Imagens não utilizadas
DANGLING_IMAGES=$(docker images -f "dangling=true" -q | wc -l)
if [ "$DANGLING_IMAGES" -gt 0 ]; then
    log_warn "Imagens órfãs: $DANGLING_IMAGES"
    if $FIX_MODE; then
        docker image prune -f
        log_fix "Imagens órfãs removidas"
    fi
else
    log_ok "Imagens órfãs: 0"
fi

# Volumes não utilizados
UNUSED_VOLUMES=$(docker volume ls -f "dangling=true" -q | wc -l)
if [ "$UNUSED_VOLUMES" -gt 0 ]; then
    log_warn "Volumes não utilizados: $UNUSED_VOLUMES"
    # NÃO limpar automaticamente - pode ter dados importantes
    log_info "  → Use 'docker volume prune' manualmente se necessário"
else
    log_ok "Volumes órfãos: 0"
fi

# =============================================================================
# RESUMO FINAL
# =============================================================================
echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                       RESUMO DA VERIFICAÇÃO                       ║${NC}"
echo -e "${CYAN}╠═══════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║  ${GREEN}Corrigidos:${NC}  $FIXED                                               ${CYAN}║${NC}"
echo -e "${CYAN}║  ${YELLOW}Avisos:${NC}      $WARNINGS                                               ${CYAN}║${NC}"
echo -e "${CYAN}║  ${RED}Erros:${NC}       $ERRORS                                               ${CYAN}║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✓ Servidor pronto para deploy da Alice Enterprise Platform!${NC}"
    exit 0
else
    echo -e "${RED}✗ Existem $ERRORS erros que precisam ser corrigidos${NC}"
    echo -e "  Execute com --fix para tentar corrigir automaticamente"
    exit 1
fi
