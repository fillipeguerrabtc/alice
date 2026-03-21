#!/bin/bash
# =============================================================================
# Script de Configuração Inicial do Servidor Hetzner GPU - Alice Enterprise Platform
# =============================================================================
# Descrição: Configura servidor Hetzner GPU para deploy da Alice Enterprise Platform
#            Instala Docker, driver NVIDIA e NVIDIA Container Toolkit com validacao CDI
#
# ARQUITETURA ENTERPRISE (02/01/2026):
# - 35 containers (infra + Alice + observability + backup + GPU)
# - GPU Services: Mixtral 8x7B, Embeddings (Qwen3), ASR Canary, Trainer
# - Servidor Único: Todos os containers no mesmo servidor (latência zero)
#
# Uso: Executado a partir do repositorio local com os scripts de infraestrutura
#      ou transferido pelo pipeline CI/CD para o host de producao
#
# Autor: Fillipe Guerra
# Data: 21 de Marco de 2026
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NVIDIA_RUNTIME_CHECK_SCRIPT="${SCRIPT_DIR}/check-nvidia-runtime.sh"

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
echo "║     ALICE ENTERPRISE PLATFORM - SETUP HETZNER GPU SERVER          ║"
echo "║     Arquitetura: Servidor Único com GPU (25/12/2025)               ║"
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
    apt-transport-https
    ubuntu-drivers-common
)

log_info "Instalando: ${PACKAGES[*]}"
DEBIAN_FRONTEND=noninteractive apt-get install -y "${PACKAGES[@]}"

log_ok "Pacotes essenciais instalados"

# =============================================================================
# 3. INSTALAR DOCKER
# =============================================================================
log_header "3. INSTALANDO DOCKER"

# Verificar se Docker já está instalado
if command -v docker >/dev/null 2>&1; then
    log_info "Docker já está instalado: $(docker --version)"
else
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
fi

# Verificar instalação
log_ok "Docker: $(docker --version)"
log_ok "Docker Compose: $(docker compose version)"

# =============================================================================
# 4. INSTALAR NVIDIA DRIVER
# =============================================================================
log_header "4. INSTALANDO NVIDIA DRIVER"

# Verificar se GPU está presente
if ! lspci | grep -i nvidia >/dev/null 2>&1; then
    log_warn "GPU NVIDIA não detectada. Continuando sem driver NVIDIA..."
else
    # Verificar se driver já está instalado
    if command -v nvidia-smi >/dev/null 2>&1; then
        log_info "NVIDIA Driver já está instalado:"
        nvidia-smi --query-gpu=name,driver_version --format=csv,noheader
    else
        log_info "Instalando driver NVIDIA recomendado pelo Ubuntu..."

        apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y ubuntu-drivers-common
        DEBIAN_FRONTEND=noninteractive ubuntu-drivers install
        
        log_warn "Driver instalado. REINICIE o servidor para carregar o driver:"
        log_warn "  reboot"
        log_warn "Após reiniciar, execute novamente este script para instalar NVIDIA Container Toolkit"
        
        # Se estamos em modo não-interativo (pipeline), não reinicia automaticamente
        if [ -z "${CI:-}" ]; then
            read -p "Reiniciar agora? (s/N): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Ss]$ ]]; then
                reboot
            fi
        fi
    fi
fi

# =============================================================================
# 5. INSTALAR NVIDIA CONTAINER TOOLKIT
# =============================================================================
log_header "5. INSTALANDO NVIDIA CONTAINER TOOLKIT"

# Verificar se nvidia-smi funciona (driver carregado)
if ! nvidia-smi >/dev/null 2>&1; then
    log_warn "nvidia-smi não funciona. Driver pode não estar carregado."
    log_warn "Execute 'reboot' e rode este script novamente."
else
    log_info "Configurando repositório oficial do NVIDIA Container Toolkit..."

    install -m 0755 -d /usr/share/keyrings
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
      | gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    chmod a+r /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
      | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
      | tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null

    apt-get update
    apt-get install -y \
      nvidia-container-toolkit \
      nvidia-container-toolkit-base \
      libnvidia-container-tools \
      libnvidia-container1

    if [[ ! -f "$NVIDIA_RUNTIME_CHECK_SCRIPT" ]]; then
        log_error "Script obrigatório não encontrado: $NVIDIA_RUNTIME_CHECK_SCRIPT"
    fi

    log_info "Configurando runtime Docker via nvidia-ctk e reconciliando CDI..."
    bash "$NVIDIA_RUNTIME_CHECK_SCRIPT" \
      --configure-docker-runtime \
      --refresh-cdi \
      --reconcile-legacy-cdi

    log_ok "NVIDIA Container Toolkit instalado e validado"
    log_info "Comportamento esperado: /var/run/cdi/nvidia.yaml é a fonte gerada pelo toolkit; /etc/cdi/nvidia.yaml fica desativado quando encontrado"
fi

# =============================================================================
# 6. CONFIGURAR FIREWALL (UFW)
# =============================================================================
log_header "6. CONFIGURANDO FIREWALL"

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
# 7. CONFIGURAR VOLUME HETZNER (se existir)
# =============================================================================
log_header "7. CONFIGURANDO VOLUME HETZNER"

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
# 8. CRIAR ESTRUTURA DE DIRETÓRIOS ENTERPRISE
# =============================================================================
log_header "8. CRIANDO ESTRUTURA DE DIRETÓRIOS"

# Diretórios principais
DIRS=(
    /opt/alice/app
    /opt/alice/data/postgres
    /opt/alice/data/redis-alice
    /opt/alice/data/qdrant
    /opt/alice/data/caddy
    /opt/alice/data/caddy-config
    /opt/alice/data/searxng-config
    /opt/alice/data/vector
    # REMOVIDO 01/01/2026: alertmanager substituído por Grafana Alerting
    /opt/alice/data/langfuse-db
    /opt/alice/data/prometheus
    /opt/alice/data/grafana
    /opt/alice/data/loki
    /opt/alice/uploads/tts
    /opt/alice/uploads/media
    /opt/alice/backups/postgresql/logs
    /opt/alice/backups/redis
    /opt/alice/backups/manifests
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
# 9. CRIAR REDES DOCKER
# =============================================================================
log_header "9. CRIANDO REDES DOCKER"

docker network create alice-network 2>/dev/null || log_info "Rede alice-network já existe"

log_ok "Redes Docker criadas"

# =============================================================================
# 10. CONFIGURAR LIMITES DO SISTEMA
# =============================================================================
log_header "10. CONFIGURANDO LIMITES DO SISTEMA"

# Aumentar limites de arquivos abertos
cat > /etc/security/limits.d/alice.conf << 'EOF'
# Limites para Alice Enterprise Platform
*               soft    nofile          1048576
*               hard    nofile          1048576
*               soft    nproc           65535
*               hard    nproc           65535
root            soft    nofile          1048576
root            hard    nofile          1048576
root            soft    nproc           65535
root            hard    nproc           65535
EOF

# Configurar sysctl para Docker/Containers
cat > /etc/sysctl.d/99-alice.conf << 'EOF'
# Configurações para Alice Enterprise Platform
# Memória
vm.swappiness = 10
vm.overcommit_memory = 1
# IPv6
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
net.ipv6.conf.lo.disable_ipv6 = 1
# Network
net.core.somaxconn = 65535
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
# File system
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
EOF

sysctl -p /etc/sysctl.d/99-alice.conf

CURRENT_OVERCOMMIT="$(sysctl -n vm.overcommit_memory 2>/dev/null || echo '')"
if [ "${CURRENT_OVERCOMMIT}" != "1" ]; then
    log_error "vm.overcommit_memory não foi aplicado corretamente (valor atual: ${CURRENT_OVERCOMMIT:-desconhecido})"
fi

log_ok "Limites do sistema configurados"

# =============================================================================
# 11. DESABILITAR THP (Transparent Huge Pages)
# =============================================================================
log_header "11. DESABILITANDO THP (TRANSPARENT HUGE PAGES)"

# Aplicar imediatamente (se disponível)
if [ -f /sys/kernel/mm/transparent_hugepage/enabled ]; then
    echo never > /sys/kernel/mm/transparent_hugepage/enabled
fi
if [ -f /sys/kernel/mm/transparent_hugepage/defrag ]; then
    echo never > /sys/kernel/mm/transparent_hugepage/defrag
fi

# Garantir persistência via systemd
cat > /etc/systemd/system/disable-thp.service << 'EOF'
[Unit]
Description=Desabilitar Transparent Huge Pages (THP)
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'if [ -f /sys/kernel/mm/transparent_hugepage/enabled ]; then echo never > /sys/kernel/mm/transparent_hugepage/enabled; fi; if [ -f /sys/kernel/mm/transparent_hugepage/defrag ]; then echo never > /sys/kernel/mm/transparent_hugepage/defrag; fi'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now disable-thp.service

log_ok "THP desabilitado (enabled/defrag = never)"

# =============================================================================
# 12. INFORMAÇÕES FINAIS
# =============================================================================
log_header "CONFIGURAÇÃO CONCLUÍDA"

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  SERVIDOR HETZNER GPU CONFIGURADO COM SUCESSO!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Servidor: $(hostname)"
echo "IP: $(curl -s ifconfig.me 2>/dev/null || echo 'N/A')"
echo ""
echo "Versões instaladas:"
echo "  - OS: $(lsb_release -ds)"
echo "  - Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"
echo "  - Docker Compose: $(docker compose version | grep -oP '\d+\.\d+\.\d+' || echo 'N/A')"
echo "  - Python: $(python3 --version)"

# Verificar GPU
if command -v nvidia-smi >/dev/null 2>&1; then
    echo ""
    echo "GPU:"
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1 | while IFS=, read -r name memory; do
        echo "  - $name ($memory)"
    done
else
    echo ""
    echo "  - GPU: Driver não instalado ou não detectado"
fi

echo ""
echo "Estrutura criada:"
echo "  - /opt/alice/app       → Código da aplicação"
echo "  - /opt/alice/data      → Dados dos bancos"
echo "  - /opt/alice/uploads   → Uploads multimodais"
echo "  - /opt/alice/backups   → Backups enterprise"
echo "  - /opt/alice/logs      → Logs dos serviços"
echo "  - /opt/alice/secrets   → Secrets (700)"
echo ""
echo "Próximos passos:"
echo "  1. Configure os GitHub Secrets no repositório"
echo "  2. Atualize HETZNER_VM_HOST com o IP do servidor GPU"
echo "  3. Execute o fluxo oficial de deploy quando o host estiver pronto"
echo "  4. Após patch ou reboot, valide o runtime NVIDIA/CDI antes de subir os serviços GPU"
echo ""
echo "Documentação: docs/operations/deploy.md"
echo "Runbook GPU/CDI: docs/operations/runbooks/gpu-cdi-maintenance.md"
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
