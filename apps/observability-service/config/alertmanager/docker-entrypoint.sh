#!/bin/sh
# Alertmanager Docker Entrypoint - Alice Enterprise Platform
#
# Cria arquivos de secrets a partir de variáveis de ambiente
# antes de iniciar o Alertmanager.
#
# Documentação PT-BR (Regra 10 CLAUDE.md)

set -e

SECRETS_DIR="/etc/alertmanager/secrets"

# Criar diretório de secrets
mkdir -p "$SECRETS_DIR"

# SMTP Password (obrigatório para email)
if [ -n "$SMTP_PASSWORD" ]; then
  echo -n "$SMTP_PASSWORD" > "$SECRETS_DIR/smtp_password"
  chmod 600 "$SECRETS_DIR/smtp_password"
  echo "SMTP password configurado"
else
  echo "AVISO: SMTP_PASSWORD não configurado - emails não funcionarão"
  echo -n "" > "$SECRETS_DIR/smtp_password"
fi

# Slack Webhook URL (opcional)
if [ -n "$SLACK_WEBHOOK_URL" ]; then
  echo -n "$SLACK_WEBHOOK_URL" > "$SECRETS_DIR/slack_webhook_url"
  chmod 600 "$SECRETS_DIR/slack_webhook_url"
  echo "Slack webhook configurado"
else
  echo "AVISO: SLACK_WEBHOOK_URL não configurado - notificações Slack desabilitadas"
  # Criar arquivo vazio para evitar erro de arquivo não encontrado
  echo -n "http://localhost:9999/disabled" > "$SECRETS_DIR/slack_webhook_url"
fi

# Iniciar Alertmanager com os argumentos passados
exec /bin/alertmanager "$@"
