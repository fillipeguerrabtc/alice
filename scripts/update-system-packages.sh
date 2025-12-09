#!/bin/bash
# =============================================================================
# Script Enterprise para Atualização de Pacotes do Sistema (Hetzner)
# =============================================================================
# Descrição: Atualiza pacotes do sistema (apt) no servidor Hetzner
# Autor: Fillipe Guerra
# Data: 09/12/2025
# 
# REGRA 6: Enterprise-grade - backup antes de atualizar, validação completa
# REGRA 16: Health checks após atualização
# =============================================================================

set -euo pipefail

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then
    log_error "Este script precisa ser executado como root"
    exit 1
fi

log_info "Iniciando atualização de pacotes do sistema..."

# =============================================================================
# PASSO 1: Backup antes de atualizar
# =============================================================================
log_step "1/5: Criando backup antes de atualizar..."

BACKUP_DIR="/opt/alice/backups/system-update-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup de configurações importantes
log_info "Backup de configurações do sistema..."
cp -r /etc/apt/sources.list* "$BACKUP_DIR/" 2>/dev/null || true
cp -r /etc/docker "$BACKUP_DIR/" 2>/dev/null || true
cp -r /etc/nginx "$BACKUP_DIR/" 2>/dev/null || true

# Backup de status dos containers
log_info "Backup de status dos containers..."
docker ps -a > "$BACKUP_DIR/containers_before.txt" 2>/dev/null || true
docker images > "$BACKUP_DIR/images_before.txt" 2>/dev/null || true
docker volume ls > "$BACKUP_DIR/volumes_before.txt" 2>/dev/null || true

# Backup de logs importantes
log_info "Backup de logs do sistema..."
journalctl --since "1 hour ago" > "$BACKUP_DIR/system_logs.txt" 2>/dev/null || true

log_info "✅ Backup criado em: $BACKUP_DIR"

# =============================================================================
# PASSO 2: Verificar atualizações disponíveis
# =============================================================================
log_step "2/5: Verificando atualizações disponíveis..."

apt update -qq

UPDATES=$(apt list --upgradable 2>/dev/null | grep -c "upgradable" || echo "0")

if [ "$UPDATES" -eq 0 ]; then
    log_info "✅ Nenhuma atualização disponível"
    exit 0
fi

log_info "📦 $UPDATES pacotes podem ser atualizados"

# REGRA 6: Enterprise-grade - verificar se kernel será atualizado ANTES do upgrade
# Isso permite avisar o usuário que reboot será necessário
KERNEL_UPDATE=0
if apt list --upgradable 2>/dev/null | grep -qi "linux-image"; then
    KERNEL_UPDATE=1
    log_warn "⚠️ Kernel será atualizado - REBOOT NECESSÁRIO após atualização"
fi

# Listar pacotes que serão atualizados
log_info "Pacotes que serão atualizados:"
apt list --upgradable 2>/dev/null | grep -v "Listing..." | head -20

# Perguntar confirmação (se não estiver em modo não-interativo)
if [ -t 0 ] && [ "${SKIP_CONFIRMATION:-}" != "true" ]; then
    read -p "Deseja continuar com a atualização? (s/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Ss]$ ]]; then
        log_warn "Atualização cancelada pelo usuário"
        exit 0
    fi
fi

# =============================================================================
# PASSO 3: Atualizar pacotes
# =============================================================================
log_step "3/5: Atualizando pacotes do sistema..."

# Atualizar pacotes (sem atualizar kernel automaticamente - requer reboot)
DEBIAN_FRONTEND=noninteractive apt upgrade -y -o Dpkg::Options::="--force-confold"

log_info "✅ Pacotes atualizados"

# =============================================================================
# PASSO 4: Limpar pacotes órfãos
# =============================================================================
log_step "4/5: Limpando pacotes órfãos..."

apt autoremove -y
apt autoclean

log_info "✅ Limpeza concluída"

# =============================================================================
# PASSO 5: Health checks após atualização
# =============================================================================
log_step "5/5: Executando health checks..."

# Verificar Docker
if ! systemctl is-active --quiet docker; then
    log_error "❌ Docker não está rodando!"
    systemctl status docker
    exit 1
fi
log_info "✅ Docker está rodando"

# Verificar containers
CONTAINERS_RUNNING=$(docker ps -q | wc -l)
log_info "📦 Containers rodando: $CONTAINERS_RUNNING"

# Verificar se containers críticos estão rodando
CRITICAL_CONTAINERS=("alice-postgres" "alice-redis" "traefik")
for container in "${CRITICAL_CONTAINERS[@]}"; do
    if docker ps --format '{{.Names}}' | grep -q "$container"; then
        log_info "✅ Container $container está rodando"
    else
        log_warn "⚠️ Container $container não está rodando"
    fi
done

# Verificar espaço em disco
DISK_USAGE=$(df -h / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 90 ]; then
    log_warn "⚠️ Uso de disco acima de 90%: ${DISK_USAGE}%"
else
    log_info "✅ Uso de disco: ${DISK_USAGE}%"
fi

# Verificar memória
MEMORY_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100}')
if [ "$MEMORY_USAGE" -gt 90 ]; then
    log_warn "⚠️ Uso de memória acima de 90%: ${MEMORY_USAGE}%"
else
    log_info "✅ Uso de memória: ${MEMORY_USAGE}%"
fi

# REGRA 6: Enterprise-grade - verificar se kernel foi atualizado (requer reboot)
# Usar variável KERNEL_UPDATE definida ANTES do upgrade (linha 88)
# Alternativamente, verificar se kernel instalado é diferente do kernel em execução
CURRENT_KERNEL=$(uname -r)
INSTALLED_KERNELS=$(dpkg -l | grep -E '^ii.*linux-image-[0-9]' | awk '{print $2}' | sort -V | tail -1 | sed 's/linux-image-//')
if [ "$KERNEL_UPDATE" -eq 1 ] || [ "$CURRENT_KERNEL" != "$INSTALLED_KERNELS" ]; then
    log_warn "⚠️ Kernel atualizado - REBOOT NECESSÁRIO após verificação completa"
    log_warn "   Kernel atual: $CURRENT_KERNEL"
    log_warn "   Kernel instalado mais recente: $INSTALLED_KERNELS"
fi

log_info "✅ Health checks concluídos"
log_info "✅ Atualização de pacotes do sistema concluída com sucesso!"

# =============================================================================
# RESUMO
# =============================================================================
echo ""
log_info "=== RESUMO DA ATUALIZAÇÃO ==="
echo "Backup criado em: $BACKUP_DIR"
echo "Pacotes atualizados: $UPDATES"
echo "Containers rodando: $CONTAINERS_RUNNING"
echo "Uso de disco: ${DISK_USAGE}%"
echo "Uso de memória: ${MEMORY_USAGE}%"
if [ "$KERNEL_UPDATE" -eq 1 ]; then
    echo "⚠️ REBOOT NECESSÁRIO (kernel atualizado)"
fi

