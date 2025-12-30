#!/bin/sh
# Alertmanager Docker Entrypoint - Alice Enterprise Platform
#
# MIGRAÇÃO 30/12/2025: De Resend para Gmail SMTP
# Gmail SMTP permite enviar para QUALQUER email (clientes, equipe, vendas).
# Resend gratuito só permite enviar para o próprio email da conta.
#
# Integração Gmail SMTP:
# - Host: smtp.gmail.com:587
# - Username: Email Gmail completo (SMTP_USER)
# - Password: App Password de 16 caracteres (arquivo /run/secrets/smtp_password)
# - Sender: Mesmo email Gmail (SMTP_FROM)
#
# Ref: https://support.google.com/accounts/answer/185833
# Documentação PT-BR (Regra 10 CLAUDE.md)

set -e

CONFIG_TEMPLATE="/etc/alertmanager/alertmanager.yml"
CONFIG_OUTPUT="/etc/alertmanager/alertmanager-processed.yml"
SECRETS_DIR="/etc/alertmanager/secrets"

echo "=== Alertmanager Entrypoint Enterprise ==="
echo "Data: $(date -Iseconds)"

# =============================================================================
# FASE 1: Criar diretório de secrets
# =============================================================================
mkdir -p "$SECRETS_DIR"

# =============================================================================
# FASE 2: SMTP Password via Gmail App Password
# =============================================================================
# Gmail usa App Password (16 caracteres) para autenticação SMTP
# O arquivo /run/secrets/smtp_password é montado via docker-compose
if [ -f "/run/secrets/smtp_password" ] && [ -s "/run/secrets/smtp_password" ]; then
  # Copiar para diretório de secrets local (compatibilidade com alertmanager.yml)
  cp /run/secrets/smtp_password "$SECRETS_DIR/smtp_password"
  chmod 600 "$SECRETS_DIR/smtp_password"
  echo "✅ SMTP configurado com Gmail App Password (via /run/secrets/smtp_password)"
elif [ -n "$GMAIL_APP_PASSWORD" ]; then
  # Fallback: usar variável de ambiente
  echo -n "$GMAIL_APP_PASSWORD" > "$SECRETS_DIR/smtp_password"
  chmod 600 "$SECRETS_DIR/smtp_password"
  echo "✅ SMTP configurado com GMAIL_APP_PASSWORD (via env)"
else
  echo "⚠️ AVISO: SMTP não configurado - emails não funcionarão"
  echo "   Configure o secret GMAIL_APP_PASSWORD no repositório"
  echo -n "" > "$SECRETS_DIR/smtp_password"
fi

# =============================================================================
# FASE 3: Slack Webhook URL (opcional)
# =============================================================================
if [ -n "$SLACK_WEBHOOK_URL" ]; then
  echo -n "$SLACK_WEBHOOK_URL" > "$SECRETS_DIR/slack_webhook_url"
  chmod 600 "$SECRETS_DIR/slack_webhook_url"
  echo "✅ Slack webhook configurado"
else
  # Criar arquivo placeholder para evitar erro de arquivo não encontrado
  echo -n "http://localhost:9999/disabled" > "$SECRETS_DIR/slack_webhook_url"
  echo "ℹ️ Slack webhook não configurado (desabilitado)"
fi

# =============================================================================
# FASE 4: Substituir variáveis no alertmanager.yml via envsubst
# =============================================================================
# Gmail SMTP requer várias variáveis no alertmanager.yml:
# - ${SMTP_USER}: Email Gmail completo (username para autenticação)
# - ${SMTP_FROM}: Email remetente (mesmo que SMTP_USER)
# - ${ALERT_EMAIL}: Email destinatário dos alertas
echo ""
echo "📝 Substituindo variáveis de ambiente no alertmanager.yml..."
echo "   SMTP_USER=${SMTP_USER:-<não definido>}"
echo "   SMTP_FROM=${SMTP_FROM:-<não definido>}"
echo "   ALERT_EMAIL=${ALERT_EMAIL:-<não definido>}"

# Validar variáveis obrigatórias
if [ -z "$SMTP_USER" ]; then
  echo "❌ ERRO: SMTP_USER não definido. Configure GMAIL_USER nos secrets do repositório."
  exit 1
fi

if [ -z "$SMTP_FROM" ]; then
  echo "❌ ERRO: SMTP_FROM não definido. Configure GMAIL_USER nos secrets do repositório."
  exit 1
fi

if [ -z "$ALERT_EMAIL" ]; then
  echo "❌ ERRO: ALERT_EMAIL não definido. Configure GMAIL_USER nos secrets do repositório."
  exit 1
fi

# Verificar se o template existe
if [ ! -f "$CONFIG_TEMPLATE" ]; then
  echo "❌ ERRO: Template não encontrado: $CONFIG_TEMPLATE"
  exit 1
fi

# Executar envsubst para substituir TODAS as variáveis SMTP
envsubst '${SMTP_USER} ${SMTP_FROM} ${ALERT_EMAIL}' < "$CONFIG_TEMPLATE" > "$CONFIG_OUTPUT"

# Verificar se a substituição funcionou
VARS_NOT_REPLACED=""
if grep -q '\${SMTP_USER}' "$CONFIG_OUTPUT"; then
  VARS_NOT_REPLACED="$VARS_NOT_REPLACED SMTP_USER"
fi
if grep -q '\${SMTP_FROM}' "$CONFIG_OUTPUT"; then
  VARS_NOT_REPLACED="$VARS_NOT_REPLACED SMTP_FROM"
fi
if grep -q '\${ALERT_EMAIL}' "$CONFIG_OUTPUT"; then
  VARS_NOT_REPLACED="$VARS_NOT_REPLACED ALERT_EMAIL"
fi

if [ -n "$VARS_NOT_REPLACED" ]; then
  echo "⚠️ AVISO: Variáveis não substituídas:$VARS_NOT_REPLACED"
else
  echo "✅ Todas as variáveis substituídas com sucesso"
  echo "   Remetente: $SMTP_FROM"
  echo "   Destinatário alertas: $ALERT_EMAIL"
fi

echo ""
echo "=== Iniciando Alertmanager ==="

# Iniciar Alertmanager com o arquivo processado
exec /bin/alertmanager --config.file="$CONFIG_OUTPUT" "$@"
