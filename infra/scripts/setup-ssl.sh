#!/bin/bash
# =============================================================================
# Script de Configuração SSL para Alice Enterprise Platform
# =============================================================================
# Utiliza certbot-dns-duckdns para obter certificado Let's Encrypt
# Domínio: yesyoudeserve.duckdns.org
# =============================================================================

set -e

echo "=============================================="
echo "🔒 Configurando SSL via Let's Encrypt"
echo "=============================================="

# Instalar pip3 se não existir
if ! command -v pip3 &> /dev/null; then
    echo "📦 Instalando pip3..."
    apt-get update
    apt-get install -y python3-pip
fi

# Instalar plugin certbot-dns-duckdns
echo "📦 Instalando plugin certbot-dns-duckdns..."
pip3 install certbot certbot-dns-duckdns --break-system-packages 2>/dev/null || pip3 install certbot certbot-dns-duckdns

# Criar credenciais DuckDNS
echo "🔑 Configurando credenciais DuckDNS..."
mkdir -p /etc/letsencrypt
cat > /etc/letsencrypt/duckdns.ini << 'CREDS'
dns_duckdns_token = 3be81a28-fcbe-453e-948b-3e0b7361b023
CREDS
chmod 600 /etc/letsencrypt/duckdns.ini

# Obter certificado
echo "🔐 Obtendo certificado SSL..."
certbot certonly \
  --authenticator dns-duckdns \
  --dns-duckdns-credentials /etc/letsencrypt/duckdns.ini \
  --dns-duckdns-propagation-seconds 120 \
  --dns-duckdns-no-txt-restore \
  --agree-tos \
  --non-interactive \
  --email fillipe.backup1@gmail.com \
  -d "yesyoudeserve.duckdns.org"

# Configurar Nginx com SSL
echo "🌐 Configurando Nginx com SSL..."
cat > /etc/nginx/sites-available/alice << 'NGINX_SSL'
# Configuração Nginx com SSL para Alice Enterprise Platform
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

# Redirecionar HTTP para HTTPS
server {
    listen 80;
    server_name yesyoudeserve.duckdns.org;
    return 301 https://$server_name$request_uri;
}

# Servidor HTTPS
server {
    listen 443 ssl http2;
    server_name yesyoudeserve.duckdns.org;

    # Certificados Let's Encrypt
    ssl_certificate /etc/letsencrypt/live/yesyoudeserve.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yesyoudeserve.duckdns.org/privkey.pem;

    # Configurações SSL seguras
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Headers de segurança
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Logs
    access_log /var/log/nginx/alice-access.log;
    error_log /var/log/nginx/alice-error.log;

    # Limite de upload
    client_max_body_size 100M;

    # Auth Service
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

    # Chat Service (com WebSocket)
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
        proxy_read_timeout 86400;
    }

    # WebSocket
    location /ws/ {
        proxy_pass http://chat_service/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # RAG Service
    location /api/rag/ {
        proxy_pass http://rag_service/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Training Service
    location /api/training/ {
        proxy_pass http://training_service/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Integrations Service
    location /api/integrations/ {
        proxy_pass http://integrations_service/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check
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
NGINX_SSL

# Testar e recarregar Nginx
nginx -t && systemctl reload nginx

# Configurar renovação automática
echo "0 3 */60 * * root certbot renew --dns-duckdns-no-txt-restore --quiet --post-hook 'systemctl reload nginx'" >> /etc/crontab

echo "=============================================="
echo "✅ SSL configurado com sucesso!"
echo "URL: https://yesyoudeserve.duckdns.org"
echo "=============================================="
