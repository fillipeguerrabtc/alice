#!/bin/sh
# =============================================================================
# Alertmanager Docker Entrypoint - Alice Enterprise Platform
# =============================================================================
# CORREÇÃO 29/12/2025: Adiciona expansão de variáveis de ambiente no config YAML
# 
# Alertmanager NÃO expande ${VAR} automaticamente no YAML!
# Este script usa envsubst para substituir variáveis antes de iniciar.
#
# Integração Resend (SMTP simplificado):
# - Host: smtp.resend.com:587
# - Username: resend (fixo)
# - Password: RESEND_API_KEY (via /run/secrets/smtp_password)
# - Sender: onboarding@resend.dev (não requer domínio verificado)
#
# Author: Fillipe Guerra
# Data: 29 de Dezembro de 2025
# Documentação PT-BR (Regra 10 CLAUDE.md)
# =============================================================================

set -e

CONFIG_TEMPLATE="/etc/alertmanager/alertmanager.yml"
CONFIG_FINAL="/tmp/alertmanager.yml"

echo "=================================================="
echo "  Alertmanager Entrypoint - Alice Platform"
echo "=================================================="

# =============================================================================
# FASE 1: Expansão de variáveis de ambiente no YAML
# =============================================================================
# Alertmanager não expande ${VAR} nativamente - precisamos fazer manualmente
# envsubst substitui ${ALERT_EMAIL}, ${CRITICAL_EMAIL}, ${ONCALL_EMAIL}

echo "📝 Expandindo variáveis de ambiente no arquivo de configuração..."

# Validar variáveis obrigatórias
if [ -z "$ALERT_EMAIL" ]; then
  echo "⚠️ AVISO: ALERT_EMAIL não definido - usando default"
  export ALERT_EMAIL="alerts@localhost"
fi

if [ -z "$CRITICAL_EMAIL" ]; then
  echo "⚠️ AVISO: CRITICAL_EMAIL não definido - usando ALERT_EMAIL"
  export CRITICAL_EMAIL="$ALERT_EMAIL"
fi

if [ -z "$ONCALL_EMAIL" ]; then
  echo "⚠️ AVISO: ONCALL_EMAIL não definido - usando ALERT_EMAIL"
  export ONCALL_EMAIL="$ALERT_EMAIL"
fi

echo "   ALERT_EMAIL: $ALERT_EMAIL"
echo "   CRITICAL_EMAIL: $CRITICAL_EMAIL"
echo "   ONCALL_EMAIL: $ONCALL_EMAIL"

# Substituir variáveis usando envsubst
# Lista explícita de variáveis para evitar substituição acidental de templates Go
envsubst '$ALERT_EMAIL $CRITICAL_EMAIL $ONCALL_EMAIL' < "$CONFIG_TEMPLATE" > "$CONFIG_FINAL"

echo "✅ Configuração gerada em $CONFIG_FINAL"

# =============================================================================
# FASE 2: Validar secret SMTP (Resend API Key)
# =============================================================================
SMTP_SECRET="/run/secrets/smtp_password"

if [ -f "$SMTP_SECRET" ] && [ -s "$SMTP_SECRET" ]; then
  echo "✅ SMTP secret encontrado ($SMTP_SECRET)"
else
  echo "⚠️ AVISO: SMTP secret não encontrado ou vazio - emails desabilitados"
fi

echo "=================================================="
echo "  Iniciando Alertmanager..."
echo "=================================================="

# Iniciar Alertmanager com config processado
exec /bin/alertmanager --config.file="$CONFIG_FINAL" "$@"
