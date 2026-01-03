#!/bin/sh
# =============================================================================
# Caddy Entrypoint - Diagnostic & Validation
# =============================================================================
# Autor: Fillipe Guerra
# Data: 03/01/2026
#
# Este entrypoint wrapper adiciona diagnóstico e validação ANTES de iniciar
# o Caddy, permitindo identificar problemas de configuração no startup.
#
# Funcionalidades:
# - Valida se ACME_EMAIL está definido
# - Valida sintaxe do Caddyfile
# - Loga configurações no startup para troubleshooting
# - Falha imediatamente se houver problemas (fail-fast)
#
# Referência: https://caddyserver.com/docs/command-line#caddy-validate
# =============================================================================

set -e

echo "=========================================="
echo "🚀 Caddy Startup Diagnostics"
echo "=========================================="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Container: $(hostname)"
echo ""

# =================================================================
# Validar ACME_EMAIL
# =================================================================
echo "📧 Verificando ACME_EMAIL..."
if [ -z "${ACME_EMAIL}" ]; then
    echo "⚠️  AVISO: ACME_EMAIL não está definido!"
    echo "    Caddy usará fallback: fillipe.backup@gmail.com"
    echo "    Isso é aceitável para testes, mas configure ACME_EMAIL em produção"
else
    echo "✅ ACME_EMAIL configurado: ${ACME_EMAIL}"
fi
echo ""

# =================================================================
# Validar Caddyfile
# =================================================================
echo "📋 Validando Caddyfile..."
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1; then
    echo ""
    echo "❌ ERRO CRÍTICO: Caddyfile inválido!"
    echo "   O Caddy não pode iniciar com configuração inválida."
    echo "   Verifique a sintaxe do Caddyfile acima."
    exit 1
fi
echo "✅ Caddyfile válido"
echo ""

# =================================================================
# Informações do Sistema
# =================================================================
echo "🔧 Informações do Sistema:"
echo "   Caddy Version: $(caddy version | head -1)"
echo "   Working Dir: $(pwd)"
echo "   User: $(whoami)"
echo "   UID/GID: $(id)"
echo ""

# =================================================================
# Verificar Diretórios
# =================================================================
echo "📁 Verificando diretórios necessários..."
for dir in /data /config /var/log/caddy; do
    if [ -d "$dir" ]; then
        echo "   ✅ $dir existe (permissions: $(stat -c '%a' "$dir"))"
    else
        echo "   ⚠️  $dir não existe (será criado pelo Caddy)"
    fi
done
echo ""

# =================================================================
# Iniciar Caddy
# =================================================================
echo "=========================================="
echo "🚀 Iniciando Caddy Server..."
echo "=========================================="
echo "Comando: caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"
echo ""

# Usar exec para substituir o shell pelo processo Caddy
# Isso garante que o Caddy receba sinais (SIGTERM, etc) corretamente
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
