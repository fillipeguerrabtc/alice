#!/bin/sh
# =============================================================================
# Caddy Entrypoint - Simplified Startup
# =============================================================================
# Autor: Fillipe Guerra
# Data: 03/01/2026
#
# Entrypoint simplificado para startup rápido do Caddy.
# Validação mínima para garantir fail-fast sem atrasar inicialização.
#
# Referência: https://caddyserver.com/docs/command-line#caddy-validate
# =============================================================================

set -e

echo "🚀 Starting Caddy $(caddy version | head -1 | cut -d' ' -f1)"

# =================================================================
# Validação Rápida do Caddyfile
# =================================================================
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    echo "❌ ERROR: Invalid Caddyfile configuration"
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1
    exit 1
fi

echo "✅ Configuration valid"

# =================================================================
# Verificar ACME_EMAIL (warning apenas, não bloqueia startup)
# =================================================================
if [ -z "${ACME_EMAIL}" ]; then
    echo "⚠️  WARNING: ACME_EMAIL not set - using fallback email"
fi

echo "🌐 Starting Caddy server..."

# Usar exec para substituir o shell pelo processo Caddy
# Isso garante que o Caddy receba sinais (SIGTERM, etc) corretamente
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
