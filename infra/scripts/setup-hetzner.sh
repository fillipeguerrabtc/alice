#!/bin/bash
# =============================================================================
# Script de Configuração do Servidor Hetzner para Alice Enterprise Platform
# =============================================================================
# Descrição: Configura Docker, Nginx, Certbot e dependências no servidor Hetzner
# Servidor: CX43 (8 vCPU, 16GB RAM, 160GB SSD) - Ubuntu 24.04
# Domínio: yesyoudeserve.duckdns.org
# =============================================================================

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then
    log_error "Este script precisa ser executado como root"
    exit 1
fi

log_info "Iniciando configuração do servidor Alice Enterprise..."

# =============================================================================
# 1. Atualizar Sistema
# =============================================================================
log_info "Atualizando sistema..."
apt update && apt upgrade -y

# =============================================================================
# 2. Instalar Dependências Básicas
# =============================================================================
log_info "Instalando dependências básicas..."
apt install -y \
    curl \
    wget \
    git \
    htop \
    vim \
    unzip \
    ca-certificates \
    gnupg \
    lsb-release \
    software-properties-common

# =============================================================================
# 3. Instalar Docker
# =============================================================================
log_info "Instalando Docker..."

# Remover versões antigas
apt remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Adicionar repositório oficial Docker
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Verificar instalação
docker --version
docker compose version

log_info "Docker instalado com sucesso!"

# =============================================================================
# 4. Instalar Node.js 20.x
# =============================================================================
log_info "Instalando Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node --version
npm --version

log_info "Node.js instalado com sucesso!"

# =============================================================================
# 5. Instalar Nginx
# =============================================================================
log_info "Instalando Nginx..."
apt install -y nginx

# Verificar instalação
nginx -v

log_info "Nginx instalado com sucesso!"

# =============================================================================
# 6. Instalar Certbot para SSL
# =============================================================================
log_info "Instalando Certbot..."
apt install -y certbot python3-certbot-nginx

log_info "Certbot instalado com sucesso!"

# =============================================================================
# 7. Configurar Firewall (UFW)
# =============================================================================
log_info "Configurando firewall..."

# Permitir SSH, HTTP e HTTPS
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp

# Habilitar firewall
echo "y" | ufw enable

ufw status verbose

log_info "Firewall configurado com sucesso!"

# =============================================================================
# 8. Criar Estrutura de Diretórios
# =============================================================================
log_info "Criando estrutura de diretórios..."

mkdir -p /opt/alice/{data,logs,ssl,backups}
mkdir -p /opt/alice/data/postgres
mkdir -p /var/log/alice

chmod -R 755 /opt/alice

log_info "Diretórios criados!"

# =============================================================================
# 9. Configurar PostgreSQL via Docker
# =============================================================================
log_info "Configurando PostgreSQL..."

# Criar network Docker
docker network create alice-network 2>/dev/null || true

# Gerar senha segura para PostgreSQL
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)

# Criar container PostgreSQL
docker run -d \
    --name alice-postgres \
    --network alice-network \
    --restart unless-stopped \
    -e POSTGRES_USER=alice \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    -e POSTGRES_DB=alice_prod \
    -v /opt/alice/data/postgres:/var/lib/postgresql/data \
    -p 127.0.0.1:5432:5432 \
    postgres:15-alpine

log_info "PostgreSQL configurado!"
log_warn "Senha do PostgreSQL: $POSTGRES_PASSWORD"
log_warn "GUARDE ESTA SENHA EM LOCAL SEGURO!"

# Salvar credenciais em arquivo protegido
echo "POSTGRES_USER=alice" > /opt/alice/.env.postgres
echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" >> /opt/alice/.env.postgres
echo "POSTGRES_DB=alice_prod" >> /opt/alice/.env.postgres
echo "DATABASE_URL=postgresql://alice:$POSTGRES_PASSWORD@localhost:5432/alice_prod" >> /opt/alice/.env.postgres
chmod 600 /opt/alice/.env.postgres

# =============================================================================
# 10. Configurar Nginx como Reverse Proxy
# =============================================================================
log_info "Configurando Nginx..."

cat > /etc/nginx/sites-available/alice << 'NGINX_CONFIG'
# Configuração Nginx para Alice Enterprise Platform
# Domínio: yesyoudeserve.duckdns.org

upstream frontend {
    server 127.0.0.1:5000;
}

upstream auth_service {
    server 127.0.0.1:3001;
}

upstream chat_service {
    server 127.0.0.1:3002;
}

upstream rag_service {
    server 127.0.0.1:3003;
}

upstream training_service {
    server 127.0.0.1:3004;
}

upstream integrations_service {
    server 127.0.0.1:3005;
}

server {
    listen 80;
    server_name yesyoudeserve.duckdns.org;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yesyoudeserve.duckdns.org;

    # SSL será configurado pelo Certbot
    # ssl_certificate /etc/letsencrypt/live/yesyoudeserve.duckdns.org/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/yesyoudeserve.duckdns.org/privkey.pem;

    # Segurança SSL
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;

    # Headers de segurança
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Logs
    access_log /var/log/nginx/alice-access.log;
    error_log /var/log/nginx/alice-error.log;

    # Limite de tamanho de upload
    client_max_body_size 100M;

    # Rotas de API - Auth Service
    location /api/auth/ {
        proxy_pass http://auth_service/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Rotas de API - Chat Service
    location /api/chat/ {
        proxy_pass http://chat_service/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # WebSocket support
        proxy_read_timeout 86400;
    }

    # Rotas de API - RAG Service
    location /api/rag/ {
        proxy_pass http://rag_service/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Rotas de API - Training Service
    location /api/training/ {
        proxy_pass http://training_service/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Rotas de API - Integrations Service
    location /api/integrations/ {
        proxy_pass http://integrations_service/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health checks
    location /health {
        proxy_pass http://frontend/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # Frontend (React/Vite)
    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX_CONFIG

# Habilitar site
ln -sf /etc/nginx/sites-available/alice /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Testar configuração
nginx -t

# Recarregar Nginx
systemctl reload nginx

log_info "Nginx configurado com sucesso!"

# =============================================================================
# 11. Informações Finais
# =============================================================================
echo ""
echo "============================================================================="
echo -e "${GREEN}CONFIGURAÇÃO CONCLUÍDA COM SUCESSO!${NC}"
echo "============================================================================="
echo ""
echo "Servidor: alice-prod"
echo "IP: $(curl -s ifconfig.me)"
echo "Domínio: yesyoudeserve.duckdns.org"
echo ""
echo "Serviços instalados:"
echo "  - Docker: $(docker --version)"
echo "  - Docker Compose: $(docker compose version | head -1)"
echo "  - Node.js: $(node --version)"
echo "  - Nginx: $(nginx -v 2>&1)"
echo "  - PostgreSQL: Container alice-postgres (porta 5432)"
echo ""
echo "Próximos passos:"
echo "  1. Configurar SSL com Let's Encrypt:"
echo "     certbot --nginx -d yesyoudeserve.duckdns.org"
echo ""
echo "  2. Verificar credenciais do PostgreSQL:"
echo "     cat /opt/alice/.env.postgres"
echo ""
echo "  3. Deploy via GitHub Actions (automático)"
echo ""
echo "============================================================================="
