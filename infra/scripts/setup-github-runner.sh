#!/usr/bin/env bash
# =============================================================================
# Setup GitHub Actions Self-Hosted Runner - Hetzner GPU Server
# =============================================================================
# Autor: Fillipe Guerra
# Data: 25 de Dezembro de 2025
# Descrição: Instala e configura GitHub Actions runner no servidor Hetzner
#            para deploy enterprise-grade sem dependência de SSH
# =============================================================================

set -euo pipefail

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Variáveis de configuração
RUNNER_VERSION="2.311.0"
RUNNER_DIR="/opt/alice/actions-runner"
RUNNER_USER="alice"
RUNNER_NAME="hetzner-gpu-runner"
RUNNER_LABELS="hetzner,gpu,self-hosted,linux"

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
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "Este script deve ser executado como root"
        exit 1
    fi
}

# =============================================================================
# Validação de pré-requisitos
# =============================================================================

log_info "Validando pré-requisitos..."

# Verificar se Docker está instalado
if ! command -v docker &> /dev/null; then
    log_error "Docker não está instalado. Execute setup-hetzner-gpu.sh primeiro."
    exit 1
fi

# Verificar se usuário existe
if ! id "$RUNNER_USER" &>/dev/null; then
    log_info "Criando usuário $RUNNER_USER..."
    useradd -r -m -s /bin/bash -d /opt/alice "$RUNNER_USER"
    usermod -aG docker "$RUNNER_USER"
fi

# =============================================================================
# Download e instalação do runner
# =============================================================================

log_info "Instalando GitHub Actions Runner v${RUNNER_VERSION}..."

# Criar diretório do runner
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# Download do runner
RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
log_info "Baixando runner de ${RUNNER_URL}..."
curl -o actions-runner.tar.gz -L "$RUNNER_URL"

# Extrair
log_info "Extraindo runner..."
tar xzf actions-runner.tar.gz
rm actions-runner.tar.gz

# Configurar permissões
chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_DIR"

# =============================================================================
# Configuração do runner
# =============================================================================

log_info "Configurando runner..."
log_warn "Você precisará de:"
log_warn "  1. URL do repositório GitHub (ex: https://github.com/USERNAME/REPO)"
log_warn "  2. Token de registro do runner (obtido em Settings → Actions → Runners → New self-hosted runner)"

read -p "URL do repositório GitHub: " REPO_URL
read -p "Token de registro do runner: " REGISTRATION_TOKEN

# Configurar runner
log_info "Configurando runner com nome: $RUNNER_NAME"
sudo -u "$RUNNER_USER" "$RUNNER_DIR/config.sh" \
    --url "$REPO_URL" \
    --token "$REGISTRATION_TOKEN" \
    --name "$RUNNER_NAME" \
    --work "$RUNNER_DIR/_work" \
    --labels "$RUNNER_LABELS" \
    --replace

# =============================================================================
# Instalação como serviço systemd
# =============================================================================

log_info "Instalando runner como serviço systemd..."

# Instalar serviço
"$RUNNER_DIR/svc.sh" install "$RUNNER_USER"

# Habilitar e iniciar serviço
systemctl enable actions.runner."$(basename "$REPO_URL")"."$RUNNER_NAME".service
systemctl start actions.runner."$(basename "$REPO_URL")"."$RUNNER_NAME".service

# Verificar status
if systemctl is-active --quiet actions.runner."$(basename "$REPO_URL")"."$RUNNER_NAME".service; then
    log_info "✅ Runner instalado e rodando como serviço systemd"
else
    log_error "❌ Falha ao iniciar serviço do runner"
    exit 1
fi

# =============================================================================
# Configuração de permissões Docker
# =============================================================================

log_info "Configurando permissões Docker para usuário $RUNNER_USER..."
usermod -aG docker "$RUNNER_USER"

# =============================================================================
# Verificação final
# =============================================================================

log_info "Verificando instalação..."

# Verificar se runner está rodando
if systemctl is-active --quiet actions.runner."$(basename "$REPO_URL")"."$RUNNER_NAME".service; then
    log_info "✅ Serviço do runner está rodando"
else
    log_error "❌ Serviço do runner não está rodando"
    exit 1
fi

# Verificar logs
log_info "Últimas linhas do log do runner:"
journalctl -u actions.runner."$(basename "$REPO_URL")"."$RUNNER_NAME".service -n 20 --no-pager

# =============================================================================
# Resumo
# =============================================================================

log_info "=============================================="
log_info "✅ GITHUB ACTIONS RUNNER INSTALADO COM SUCESSO"
log_info "=============================================="
log_info "Diretório: $RUNNER_DIR"
log_info "Usuário: $RUNNER_USER"
log_info "Nome: $RUNNER_NAME"
log_info "Labels: $RUNNER_LABELS"
log_info ""
log_info "Comandos úteis:"
log_info "  - Ver status: systemctl status actions.runner.$(basename "$REPO_URL").$RUNNER_NAME.service"
log_info "  - Ver logs: journalctl -u actions.runner.$(basename "$REPO_URL").$RUNNER_NAME.service -f"
log_info "  - Reiniciar: systemctl restart actions.runner.$(basename "$REPO_URL").$RUNNER_NAME.service"
log_info "  - Parar: systemctl stop actions.runner.$(basename "$REPO_URL").$RUNNER_NAME.service"
log_info ""
log_info "Próximos passos:"
log_info "  1. Verificar se o runner aparece em Settings → Actions → Runners no GitHub"
log_info "  2. Atualizar workflow para usar 'runs-on: self-hosted'"
log_info "  3. Testar deploy em ambiente de staging"
log_info "=============================================="

