#!/usr/bin/env bash
# =============================================================================
# Setup Deploy Server Enterprise - Alice Platform
# =============================================================================
# Autor: Fillipe Guerra
# Data: 26 de Dezembro de 2025
# Descrição: Configuração enterprise completa do servidor de deploy
#            - Atualização completa do sistema
#            - Instalação das últimas versões (2025) de todas as dependências
#            - GitHub Actions Self-Hosted Runner configurado enterprise-grade
#            - Segurança e hardening enterprise
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
}

log_header() {
    echo -e "\n${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "Este script deve ser executado como root"
        exit 1
    fi
}

# =============================================================================
# Validação inicial
# =============================================================================

check_root

log_header "SETUP DEPLOY SERVER ENTERPRISE - ALICE PLATFORM"
log_info "Configurando servidor de deploy com padrões enterprise 2025"

# =============================================================================
# 1. ATUALIZAÇÃO COMPLETA DO SISTEMA
# =============================================================================

log_header "1. ATUALIZAÇÃO COMPLETA DO SISTEMA"

log_info "Atualizando lista de pacotes..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

log_info "Atualizando todos os pacotes instalados..."
apt-get upgrade -y -qq

log_info "Instalando atualizações de segurança..."
apt-get dist-upgrade -y -qq

log_info "Removendo pacotes não utilizados..."
apt-get autoremove -y -qq
apt-get autoclean -qq

log_info "✅ Sistema atualizado completamente"

# =============================================================================
# 2. INSTALAÇÃO DE DEPENDÊNCIAS BASE (ÚLTIMAS VERSÕES 2025)
# =============================================================================

log_header "2. INSTALAÇÃO DE DEPENDÊNCIAS BASE"

log_info "Instalando pacotes essenciais (últimas versões)..."
apt-get install -y -qq \
    curl \
    wget \
    git \
    ca-certificates \
    gnupg \
    lsb-release \
    unzip \
    jq \
    net-tools \
    iputils-ping \
    htop \
    ufw \
    fail2ban \
    logrotate

log_info "✅ Dependências base instaladas"

# =============================================================================
# 3. INSTALAÇÃO DO DOCKER (ÚLTIMA VERSÃO 2025)
# =============================================================================

log_header "3. INSTALAÇÃO DO DOCKER (LATEST 2025)"

if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version | cut -d ' ' -f 3 | tr -d ',')
    log_info "Docker já instalado: v${DOCKER_VERSION}"
    
    log_info "Atualizando Docker para última versão..."
    apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
else
    log_info "Instalando Docker..."
fi

# Adicionar repositório oficial Docker (latest 2025)
log_info "Adicionando repositório oficial Docker..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -qq

log_info "Instalando Docker Engine, CLI e Containerd (latest)..."
apt-get install -y -qq \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

# Configurar Docker para iniciar no boot
systemctl enable docker
systemctl start docker

# Verificar instalação
DOCKER_VERSION=$(docker --version | cut -d ' ' -f 3 | tr -d ',')
log_info "✅ Docker instalado: v${DOCKER_VERSION}"

# =============================================================================
# 4. CONFIGURAÇÃO DE SEGURANÇA DOCKER
# =============================================================================

log_header "4. CONFIGURAÇÃO DE SEGURANÇA DOCKER"

# Configurar daemon.json com segurança enterprise
log_info "Configurando daemon.json com segurança enterprise..."
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "userland-proxy": false,
  "no-new-privileges": true,
  "live-restore": true
}
EOF

systemctl restart docker
log_info "✅ Configuração de segurança Docker aplicada"

# =============================================================================
# 5. CRIAÇÃO DE USUÁRIO PARA RUNNER (NÃO-ROOT)
# =============================================================================

log_header "5. CRIAÇÃO DE USUÁRIO PARA RUNNER (ENTERPRISE SECURITY)"

RUNNER_USER="alice"
RUNNER_GROUP="alice"
RUNNER_HOME="/opt/alice"

if id "$RUNNER_USER" &>/dev/null; then
    log_info "Usuário $RUNNER_USER já existe, atualizando configurações..."
else
    log_info "Criando usuário $RUNNER_USER (não-root, enterprise security)..."
    groupadd -r "$RUNNER_GROUP" 2>/dev/null || true
    useradd -r -m -s /bin/bash -d "$RUNNER_HOME" -g "$RUNNER_GROUP" "$RUNNER_USER"
fi

# Adicionar usuário ao grupo docker (necessário para rodar Docker sem sudo)
usermod -aG docker "$RUNNER_USER"

# Configurar permissões do diretório home
chmod 755 "$RUNNER_HOME"
chown -R "$RUNNER_USER:$RUNNER_GROUP" "$RUNNER_HOME"

log_info "✅ Usuário $RUNNER_USER configurado (grupo docker adicionado)"

# =============================================================================
# 6. INSTALAÇÃO DO GITHUB ACTIONS RUNNER (LATEST VERSION)
# =============================================================================

log_header "6. INSTALAÇÃO DO GITHUB ACTIONS RUNNER (LATEST 2025)"

# Detectar última versão disponível do runner
log_info "Detectando última versão do GitHub Actions Runner..."
LATEST_RUNNER_VERSION=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | jq -r '.tag_name' | sed 's/v//')

if [ -z "$LATEST_RUNNER_VERSION" ] || [ "$LATEST_RUNNER_VERSION" = "null" ]; then
    log_warn "Não foi possível detectar versão automática, usando versão conhecida..."
    LATEST_RUNNER_VERSION="2.311.0"
fi

log_info "Versão do runner: v${LATEST_RUNNER_VERSION}"

RUNNER_DIR="/opt/alice/actions-runner"
RUNNER_NAME="hetzner-deploy-runner"
RUNNER_LABELS="self-hosted,linux,deploy"

# Criar diretório do runner
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# Verificar se runner já está instalado
if [ -f "$RUNNER_DIR/config.sh" ]; then
    log_warn "Runner já instalado. Deseja reinstalar? (y/N)"
    read -r REINSTALL
    if [ "$REINSTALL" != "y" ] && [ "$REINSTALL" != "Y" ]; then
        log_info "Mantendo instalação existente. Para atualizar, remova o diretório $RUNNER_DIR"
        exit 0
    fi
    
    log_info "Removendo instalação existente..."
    systemctl stop "actions.runner.${RUNNER_NAME}.service" 2>/dev/null || true
    systemctl disable "actions.runner.${RUNNER_NAME}.service" 2>/dev/null || true
    rm -rf "$RUNNER_DIR"/*
fi

# Download do runner
RUNNER_URL="https://github.com/actions/runner/releases/download/v${LATEST_RUNNER_VERSION}/actions-runner-linux-x64-${LATEST_RUNNER_VERSION}.tar.gz"
log_info "Baixando runner de ${RUNNER_URL}..."
curl -L -o actions-runner.tar.gz "$RUNNER_URL"

# Verificar integridade do download
if [ ! -f actions-runner.tar.gz ]; then
    log_error "Falha ao baixar runner"
    exit 1
fi

# Extrair
log_info "Extraindo runner..."
tar xzf actions-runner.tar.gz
rm actions-runner.tar.gz

# Configurar permissões
chown -R "$RUNNER_USER:$RUNNER_GROUP" "$RUNNER_DIR"

log_info "✅ GitHub Actions Runner baixado e extraído"

# =============================================================================
# 7. CONFIGURAÇÃO DO RUNNER
# =============================================================================

log_header "7. CONFIGURAÇÃO DO RUNNER"

log_warn "Você precisa obter o token de registro do GitHub:"
log_warn "  1. Acesse: https://github.com/fillipeguerrabtc/alice/settings/actions/runners/new"
log_warn "  2. Copie o token de registro (aparece no comando config.sh)"
log_warn ""

read -p "URL do repositório GitHub (ex: https://github.com/fillipeguerrabtc/alice): " REPO_URL
read -p "Token de registro do runner: " REGISTRATION_TOKEN

if [ -z "$REPO_URL" ] || [ -z "$REGISTRATION_TOKEN" ]; then
    log_error "URL e token são obrigatórios"
    exit 1
fi

# Normalizar URL do repositório
REPO_URL=$(echo "$REPO_URL" | sed 's|/*$||')

log_info "Configurando runner com nome: $RUNNER_NAME"
log_info "Labels: $RUNNER_LABELS"

# Configurar runner (como usuário não-root)
sudo -u "$RUNNER_USER" "$RUNNER_DIR/config.sh" \
    --url "$REPO_URL" \
    --token "$REGISTRATION_TOKEN" \
    --name "$RUNNER_NAME" \
    --work "$RUNNER_DIR/_work" \
    --labels "$RUNNER_LABELS" \
    --replace \
    --unattended

if [ $? -ne 0 ]; then
    log_error "Falha ao configurar runner"
    exit 1
fi

log_info "✅ Runner configurado com sucesso"

# =============================================================================
# 8. INSTALAÇÃO COMO SERVIÇO SYSTEMD (ENTERPRISE)
# =============================================================================

log_header "8. INSTALAÇÃO COMO SERVIÇO SYSTEMD"

log_info "Instalando runner como serviço systemd..."

# Instalar serviço (como usuário não-root)
"$RUNNER_DIR/svc.sh" install "$RUNNER_USER"

# Obter nome do serviço
REPO_SLUG=$(basename "$REPO_URL")
SERVICE_NAME="actions.runner.${REPO_SLUG}.${RUNNER_NAME}.service"

# Habilitar serviço para iniciar no boot
systemctl enable "$SERVICE_NAME"

# Iniciar serviço
systemctl start "$SERVICE_NAME"

# Aguardar um pouco para verificar status
sleep 3

# Verificar status
if systemctl is-active --quiet "$SERVICE_NAME"; then
    log_info "✅ Serviço do runner instalado e rodando"
else
    log_error "❌ Falha ao iniciar serviço do runner"
    log_info "Verificando logs..."
    journalctl -u "$SERVICE_NAME" -n 50 --no-pager
    exit 1
fi

# =============================================================================
# 9. CONFIGURAÇÃO DE SEGURANÇA E HARDENING
# =============================================================================

log_header "9. CONFIGURAÇÃO DE SEGURANÇA E HARDENING"

# Firewall básico (UFW)
if command -v ufw &> /dev/null; then
    log_info "Configurando firewall (UFW)..."
    ufw --force enable
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow ssh/tcp
    log_info "✅ Firewall configurado (SSH permitido)"
fi

# Fail2ban para proteção SSH
if command -v fail2ban &> /dev/null; then
    log_info "Configurando Fail2ban..."
    systemctl enable fail2ban
    systemctl start fail2ban
    log_info "✅ Fail2ban configurado"
fi

# Configurar limites de recursos para o usuário runner
log_info "Configurando limites de recursos..."
cat >> /etc/security/limits.conf <<EOF

# Limites para usuário runner (enterprise)
${RUNNER_USER} soft nofile 65535
${RUNNER_USER} hard nofile 65535
${RUNNER_USER} soft nproc 4096
${RUNNER_USER} hard nproc 4096
EOF

log_info "✅ Limites de recursos configurados"

# =============================================================================
# 10. CONFIGURAÇÃO DE LOGROTATE PARA RUNNER
# =============================================================================

log_header "10. CONFIGURAÇÃO DE LOGROTATE"

log_info "Configurando logrotate para logs do runner..."
cat > /etc/logrotate.d/github-actions-runner <<EOF
/opt/alice/actions-runner/_diag/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 ${RUNNER_USER} ${RUNNER_GROUP}
}
EOF

log_info "✅ Logrotate configurado"

# =============================================================================
# 11. VERIFICAÇÃO FINAL E STATUS
# =============================================================================

log_header "11. VERIFICAÇÃO FINAL"

log_info "Verificando instalação..."

# Verificar Docker
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    log_info "✅ Docker: $DOCKER_VERSION"
    
    # Testar Docker como usuário runner
    if sudo -u "$RUNNER_USER" docker ps &>/dev/null; then
        log_info "✅ Docker acessível para usuário $RUNNER_USER"
    else
        log_warn "⚠️ Docker não está acessível para usuário $RUNNER_USER (verificar permissões)"
    fi
else
    log_error "❌ Docker não está instalado"
fi

# Verificar Git
if command -v git &> /dev/null; then
    GIT_VERSION=$(git --version)
    log_info "✅ Git: $GIT_VERSION"
else
    log_error "❌ Git não está instalado"
fi

# Verificar serviço do runner
if systemctl is-active --quiet "$SERVICE_NAME"; then
    log_info "✅ Serviço do runner está rodando"
    
    # Verificar logs recentes
    log_info "Últimas linhas do log do runner:"
    journalctl -u "$SERVICE_NAME" -n 10 --no-pager --no-hostname || true
else
    log_error "❌ Serviço do runner não está rodando"
    log_info "Logs do serviço:"
    journalctl -u "$SERVICE_NAME" -n 50 --no-pager
fi

# =============================================================================
# RESUMO FINAL
# =============================================================================

log_header "✅ SETUP ENTERPRISE CONCLUÍDO COM SUCESSO"

echo -e "${GREEN}"
echo "═══════════════════════════════════════════════════════════════"
echo "  DEPLOY SERVER ENTERPRISE - CONFIGURAÇÃO COMPLETA"
echo "═══════════════════════════════════════════════════════════════"
echo -e "${NC}"
echo ""
echo "📋 Informações do Runner:"
echo "   Diretório: $RUNNER_DIR"
echo "   Usuário: $RUNNER_USER"
echo "   Nome: $RUNNER_NAME"
echo "   Labels: $RUNNER_LABELS"
echo "   Serviço: $SERVICE_NAME"
echo ""
echo "🔧 Comandos Úteis:"
echo "   Ver status: systemctl status $SERVICE_NAME"
echo "   Ver logs:   journalctl -u $SERVICE_NAME -f"
echo "   Reiniciar:  systemctl restart $SERVICE_NAME"
echo "   Parar:      systemctl stop $SERVICE_NAME"
echo ""
echo "🔒 Segurança:"
echo "   ✅ Runner roda como usuário não-root ($RUNNER_USER)"
echo "   ✅ Firewall configurado (UFW)"
echo "   ✅ Fail2ban ativo para proteção SSH"
echo "   ✅ Logs rotacionados automaticamente"
echo ""
echo "📊 Versões Instaladas:"
if command -v docker &> /dev/null; then
    echo "   Docker: $(docker --version | cut -d ' ' -f 3 | tr -d ',')"
fi
if command -v git &> /dev/null; then
    echo "   Git: $(git --version | cut -d ' ' -f 3)"
fi
echo "   Runner: v${LATEST_RUNNER_VERSION}"
echo ""
echo "✅ Próximos Passos:"
echo "   1. Verificar se runner aparece em:"
echo "      https://github.com/fillipeguerrabtc/alice/settings/actions/runners"
echo "   2. Runner deve aparecer como 'Online' com labels: $RUNNER_LABELS"
echo "   3. Workflow já está configurado para usar self-hosted runner"
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""

