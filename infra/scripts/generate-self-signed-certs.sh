#!/usr/bin/env bash
# =============================================================================
# Generate Self-Signed Certificates (Fallback para Let's Encrypt)
# =============================================================================
# PROPÓSITO: Gerar certificados auto-assinados quando Let's Encrypt
# atinge rate limit (HTTP 429 - 5 certs/semana por domínio)
#
# USO:
#   ./generate-self-signed-certs.sh                    # Usa domínio padrão
#   ./generate-self-signed-certs.sh meu.dominio.com   # Domínio customizado
#
# NOTA: Certificados auto-assinados NÃO são confiáveis por navegadores
# por padrão. Use apenas como fallback temporário até rate limit expirar.
#
# Author: Fillipe Guerra
# Data: 02 de Janeiro de 2026
# =============================================================================
set -euo pipefail

DOMAIN="${1:-yesyoudeserve.duckdns.org}"
CERT_DIR="/opt/alice/data/caddy/fallback"
VALIDITY_DAYS=365

echo "=============================================="
echo "🔐 Gerando Certificados Auto-Assinados"
echo "=============================================="
echo "Domínio: $DOMAIN"
echo "Validade: $VALIDITY_DAYS dias"
echo "Diretório: $CERT_DIR"
echo ""

# Criar diretório se não existir
mkdir -p "$CERT_DIR"

# Verificar se já existe certificado válido
if [ -f "$CERT_DIR/cert.crt" ]; then
    # Verificar se certificado ainda é válido
    if openssl x509 -checkend 86400 -noout -in "$CERT_DIR/cert.crt" 2>/dev/null; then
        echo "⚠️  Certificado existente ainda é válido por mais de 24h"
        echo "   Use --force para regenerar mesmo assim"
        if [ "${2:-}" != "--force" ]; then
            echo "✅ Usando certificado existente"
            exit 0
        fi
    fi
fi

echo "📝 Gerando chave privada RSA 4096 bits..."
openssl genrsa -out "$CERT_DIR/cert.key" 4096

echo "📝 Gerando certificado auto-assinado..."
# Criar arquivo de configuração temporário para extensões
cat > /tmp/openssl-san.cnf << EOF
[req]
default_bits = 4096
prompt = no
default_md = sha256
req_extensions = req_ext
distinguished_name = dn

[dn]
C = BR
ST = Sao Paulo
L = Sao Paulo
O = Alice Enterprise Platform
OU = IT
CN = $DOMAIN

[req_ext]
subjectAltName = @alt_names

[alt_names]
DNS.1 = $DOMAIN
DNS.2 = *.$DOMAIN
DNS.3 = localhost
IP.1 = 127.0.0.1
EOF

# Gerar certificado
openssl req -new -x509 -sha256 -days "$VALIDITY_DAYS" \
    -key "$CERT_DIR/cert.key" \
    -out "$CERT_DIR/cert.crt" \
    -config /tmp/openssl-san.cnf

# Limpar arquivo temporário
rm -f /tmp/openssl-san.cnf

# Definir permissões
chmod 600 "$CERT_DIR/cert.key"
chmod 644 "$CERT_DIR/cert.crt"

# Verificar certificado gerado
echo ""
echo "🔍 Verificando certificado gerado..."
openssl x509 -in "$CERT_DIR/cert.crt" -noout -subject -dates

echo ""
echo "=============================================="
echo "✅ Certificado auto-assinado gerado com sucesso!"
echo "=============================================="
echo ""
echo "📁 Arquivos gerados:"
echo "   - Chave privada: $CERT_DIR/cert.key"
echo "   - Certificado: $CERT_DIR/cert.crt"
echo ""
echo "⚠️  IMPORTANTE:"
echo "   - Este certificado NÃO é confiável por navegadores"
echo "   - Use apenas como fallback até Let's Encrypt rate limit expirar"
echo "   - Para usar no Caddy, configure em infra/docker/Caddyfile:"
echo ""
echo "   {\$DOMAIN} {"
echo "     tls /data/fallback/cert.crt /data/fallback/cert.key"
echo "   }"
echo ""
