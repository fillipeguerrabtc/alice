#!/bin/bash
# =============================================================================
# Script de Configuração Inicial do Servidor Hetzner - Alice Enterprise Platform
# =============================================================================
# Descrição: Configura servidor Hetzner para deploy da Alice Enterprise Platform
#            com arquitetura 100% GPU local (Hetzner GPU GEX44)
#
# ARQUITETURA ENTERPRISE (25/12/2025):
# - 51 containers (8 infra + 7 Alice + 15 ERPNext + 14 obs + 6 GPU + 1 backup)
# - LLM: Mixtral 8x7B (vLLM AWQ) via Hetzner GPU GEX44 (RTX 4000 Ada 20GB)
# - Embeddings: Qwen3-Embedding-8B (4096 dim) + OpenCLIP (1024 dim)
# - Vector DB: Qdrant (texto) + PostgreSQL pgvector (imagem)
# - API Gateway: Caddy 2.8.4 (MIGRAÇÃO 02/01/2026)
# - GPU Manager Service: Gerenciamento centralizado de requisições GPU
#
# Servidor: GEX44 (Intel Core i5-13500 14 Core, 64GB DDR4 RAM, 2x 1.92TB NVMe SSD RAID 1, RTX 4000 Ada 20GB)
# Storage: 1.92TB interno (não é necessário volume externo)
# SO: Ubuntu 24.04 LTS
# IP: 178.63.41.108
# Domínio: yesyoudeserve.duckdns.org
#
# Uso: curl -fsSL https://raw.githubusercontent.com/.../setup-hetzner.sh | bash
#
# Autor: Fillipe Guerra
# Data: 17 de Dezembro de 2025
# =============================================================================

set -euo pipefail

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_header() {
    echo -e "\n${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"
}

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[✓ OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[⚠ WARN]${NC} $1"; }
log_error() { echo -e "${RED}[✗ ERROR]${NC} $1"; exit 1; }

# Verificar root
if [ "$EUID" -ne 0 ]; then
    log_error "Este script precisa ser executado como root"
fi

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║     ALICE ENTERPRISE PLATFORM - SETUP HETZNER SERVER              ║"
echo "║     Arquitetura: 100% GPU Local (Hetzner GEX44 - 25/12/2025)     ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# =============================================================================
# 1. ATUALIZAR SISTEMA
# =============================================================================
log_header "1. ATUALIZANDO SISTEMA"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

log_ok "Sistema atualizado"

# =============================================================================
# 2. INSTALAR PACOTES ESSENCIAIS
# =============================================================================
log_header "2. INSTALANDO PACOTES ESSENCIAIS"

PACKAGES=(
    curl
    wget
    git
    htop
    vim
    nano
    unzip
    jq
    ca-certificates
    gnupg
    lsb-release
    software-properties-common
    openssl
    python3
    python3-pip
    python3-ruamel.yaml
    apt-transport-https
)

log_info "Instalando: ${PACKAGES[*]}"
DEBIAN_FRONTEND=noninteractive apt-get install -y "${PACKAGES[@]}"

log_ok "Pacotes essenciais instalados"

# =============================================================================
# 3. INSTALAR DOCKER (VERSÃO MAIS RECENTE)
# =============================================================================
log_header "3. INSTALANDO DOCKER"

# Remover versões antigas
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Adicionar repositório oficial Docker
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Iniciar e habilitar Docker
systemctl enable docker
systemctl start docker

# Verificar instalação
log_ok "Docker: $(docker --version)"
log_ok "Docker Compose: $(docker compose version)"

# =============================================================================
# 4. CONFIGURAR FIREWALL (UFW)
# =============================================================================
log_header "4. CONFIGURANDO FIREWALL"

# Instalar UFW se não estiver instalado
apt-get install -y ufw

# Configurar regras
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS

# Habilitar (não-interativo)
echo "y" | ufw enable

log_ok "Firewall configurado"
ufw status verbose

# =============================================================================
# 5. CONFIGURAR VOLUME HETZNER (se existir)
# =============================================================================
log_header "5. CONFIGURANDO VOLUME HETZNER"

# Verificar se o volume existe
if [ -b /dev/sdb ]; then
    log_info "Volume Hetzner detectado em /dev/sdb"
    
    # Verificar se já está formatado
    if ! blkid /dev/sdb | grep -q ext4; then
        log_info "Formatando volume como ext4..."
        mkfs.ext4 -F /dev/sdb
    fi
    
    # Criar ponto de montagem
    mkdir -p /mnt/alice-data
    
    # Montar volume
    if ! mountpoint -q /mnt/alice-data; then
        mount /dev/sdb /mnt/alice-data
    fi
    
    # Adicionar ao fstab se não existir
    if ! grep -q "/mnt/alice-data" /etc/fstab; then
        echo "/dev/sdb /mnt/alice-data ext4 defaults 0 2" >> /etc/fstab
    fi
    
    # Criar symlink
    ln -sf /mnt/alice-data /opt/alice
    
    log_ok "Volume montado em /mnt/alice-data → /opt/alice"
else
    log_warn "Volume Hetzner não detectado - usando /opt/alice local"
    mkdir -p /opt/alice
fi

# =============================================================================
# 6. CRIAR ESTRUTURA DE DIRETÓRIOS ENTERPRISE
# =============================================================================
log_header "6. CRIANDO ESTRUTURA DE DIRETÓRIOS"

# Diretórios principais
DIRS=(
    /opt/alice/app
    /opt/alice/data/postgres
    /opt/alice/data/redis-alice
    /opt/alice/data/qdrant
    /opt/alice/data/caddy-data
    /opt/alice/data/caddy-config
    /opt/alice/data/searxng-config
    /opt/alice/data/erpnext-sites
    /opt/alice/data/erpnext-mariadb
    /opt/alice/data/erpnext-redis-cache
    /opt/alice/data/erpnext-redis-queue
    /opt/alice/data/vector
    # REMOVIDO 01/01/2026: alertmanager substituído por Grafana Alerting
    /opt/alice/data/langfuse-db
    /opt/alice/data/prometheus
    /opt/alice/data/grafana
    /opt/alice/data/loki
    /opt/alice/uploads/tts
    /opt/alice/uploads/media
    /opt/alice/backups/postgresql/logs
    /opt/alice/backups/mariadb
    /opt/alice/backups/redis
    /opt/alice/backups/manifests
    /opt/alice/logs/erpnext
    # REMOVIDO 01/01/2026: secrets/alertmanager - Grafana usa variáveis de ambiente
)

for dir in "${DIRS[@]}"; do
    mkdir -p "$dir"
done

# Permissões enterprise
chmod 750 /opt/alice
find /opt/alice -type d -exec chmod 750 {} \;
chmod -R 700 /opt/alice/secrets

log_ok "Estrutura de diretórios criada com permissões enterprise"

# =============================================================================
# 7. CRIAR REDES DOCKER
# =============================================================================
log_header "7. CRIANDO REDES DOCKER"

docker network create alice-network 2>/dev/null || log_info "Rede alice-network já existe"
docker network create erpnext-network 2>/dev/null || log_info "Rede erpnext-network já existe"

log_ok "Redes Docker criadas"

# =============================================================================
# 8. CONFIGURAR LIMITES DO SISTEMA
# =============================================================================
log_header "8. CONFIGURANDO LIMITES DO SISTEMA"

# Aumentar limites de arquivos abertos
cat > /etc/security/limits.d/alice.conf << 'EOF'
# Limites para Alice Enterprise Platform
*               soft    nofile          65535
*               hard    nofile          65535
root            soft    nofile          65535
root            hard    nofile          65535
EOF

# Configurar sysctl para Docker/Containers
cat > /etc/sysctl.d/99-alice.conf << 'EOF'
# Configurações para Alice Enterprise Platform
# Memória
vm.swappiness = 10
vm.overcommit_memory = 1
# Network
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
# File system
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
EOF

sysctl -p /etc/sysctl.d/99-alice.conf

log_ok "Limites do sistema configurados"

# =============================================================================
# 9. CONFIGURAR SWAP (se necessário)
# =============================================================================
log_header "9. CONFIGURANDO SWAP"

# Verificar se swap existe
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
    log_info "Criando arquivo de swap de 4GB..."
    fallocate -l 4G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    
    # Adicionar ao fstab
    if ! grep -q "/swapfile" /etc/fstab; then
        echo "/swapfile none swap sw 0 0" >> /etc/fstab
    fi
    
    log_ok "Swap de 4GB criado"
else
    log_ok "Swap já configurado"
fi

# =============================================================================
# 10. INFORMAÇÕES FINAIS
# =============================================================================
log_header "CONFIGURAÇÃO CONCLUÍDA"

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  SERVIDOR HETZNER CONFIGURADO COM SUCESSO!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Servidor: $(hostname)"
echo "IP: $(curl -s ifconfig.me)"
echo "Domínio: yesyoudeserve.duckdns.org"
echo ""
echo "Versões instaladas:"
echo "  - OS: $(lsb_release -ds)"
echo "  - Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"
echo "  - Docker Compose: $(docker compose version | grep -oP '\d+\.\d+\.\d+')"
echo "  - Python: $(python3 --version)"
echo ""
echo "Estrutura criada:"
echo "  - /opt/alice/app       → Código da aplicação"
echo "  - /opt/alice/data      → Dados dos bancos"
echo "  - /opt/alice/uploads   → Uploads multimodais"
echo "  - /opt/alice/backups   → Backups enterprise"
echo "  - /opt/alice/logs      → Logs dos serviços"
echo "  - /opt/alice/secrets   → Secrets (600)"
echo ""
echo "Próximos passos:"
echo "  1. Configure os GitHub Secrets no repositório"
echo "  2. Faça push para a branch main"
echo "  3. O deploy será automático via GitHub Actions"
echo ""
echo "Documentação: docs/DEPLOYMENT.md"
echo "Secrets: docs/SECRETS.md"
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
