#!/bin/sh
# =============================================================================
# Alertmanager Docker Entrypoint - Alice Enterprise Platform
# =============================================================================
# CORREÇÃO 29/12/2025: Adiciona expansão de variáveis de ambiente no config YAML
# 
# Alertmanager NÃO expande ${VAR} automaticamente no YAML!
# Este script usa sed para substituir variáveis antes de iniciar.
# NOTA: envsubst NÃO está disponível na imagem prom/alertmanager (busybox)
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
# CORREÇÃO 29/12/2025: Usar sed ao invés de envsubst (não disponível em busybox)

echo "Expandindo variaveis de ambiente no arquivo de configuracao..."

# Validar variáveis obrigatórias
if [ -z "$ALERT_EMAIL" ]; then
  echo "AVISO: ALERT_EMAIL nao definido - usando default"
  ALERT_EMAIL="alerts@localhost"
fi

if [ -z "$CRITICAL_EMAIL" ]; then
  echo "AVISO: CRITICAL_EMAIL nao definido - usando ALERT_EMAIL"
  CRITICAL_EMAIL="$ALERT_EMAIL"
fi

if [ -z "$ONCALL_EMAIL" ]; then
  echo "AVISO: ONCALL_EMAIL nao definido - usando ALERT_EMAIL"
  ONCALL_EMAIL="$ALERT_EMAIL"
fi

echo "   ALERT_EMAIL: $ALERT_EMAIL"
echo "   CRITICAL_EMAIL: $CRITICAL_EMAIL"
echo "   ONCALL_EMAIL: $ONCALL_EMAIL"

# =============================================================================
# Substituir variáveis usando sed (disponível em busybox/Alpine)
# CORREÇÃO 29/12/2025: envsubst não existe na imagem prom/alertmanager
# =============================================================================
cp "$CONFIG_TEMPLATE" "$CONFIG_FINAL"

# Substituir ${ALERT_EMAIL}, ${CRITICAL_EMAIL}, ${ONCALL_EMAIL}
# Usar | como delimitador para evitar problemas com @ em emails
sed -i "s|\${ALERT_EMAIL}|${ALERT_EMAIL}|g" "$CONFIG_FINAL"
sed -i "s|\${CRITICAL_EMAIL}|${CRITICAL_EMAIL}|g" "$CONFIG_FINAL"
sed -i "s|\${ONCALL_EMAIL}|${ONCALL_EMAIL}|g" "$CONFIG_FINAL"

echo "OK: Configuracao gerada em $CONFIG_FINAL"

# =============================================================================
# FASE 2: Validar secret SMTP (Resend API Key)
# =============================================================================
SMTP_SECRET="/run/secrets/smtp_password"

if [ -f "$SMTP_SECRET" ] && [ -s "$SMTP_SECRET" ]; then
  echo "OK: SMTP secret encontrado ($SMTP_SECRET)"
else
  echo "AVISO: SMTP secret nao encontrado ou vazio - emails desabilitados"
fi

echo "=================================================="
echo "  Iniciando Alertmanager..."
echo "=================================================="

# Iniciar Alertmanager com config processado
exec /bin/alertmanager --config.file="$CONFIG_FINAL" "$@"
