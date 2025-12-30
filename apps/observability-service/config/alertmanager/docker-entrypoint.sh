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
#
# CORREÇÃO CRÍTICA 30/12/2025: alertmanager.yml espera o arquivo em
# /run/secrets/smtp_password (smtp_auth_password_file). O fallback DEVE
# escrever no MESMO local para que o Alertmanager encontre a senha.
# Erro anterior: fallback escrevia em /etc/alertmanager/secrets/smtp_password
# mas Alertmanager procurava em /run/secrets/smtp_password.
SMTP_PASSWORD_FILE="/run/secrets/smtp_password"

if [ -f "$SMTP_PASSWORD_FILE" ] && [ -s "$SMTP_PASSWORD_FILE" ]; then
  # Secret montado via Docker - já está no local correto
  echo "✅ SMTP configurado com Gmail App Password (via Docker secret)"
elif [ -n "$GMAIL_APP_PASSWORD" ]; then
  # Fallback: criar arquivo no local onde alertmanager.yml espera
  # Criar diretório /run/secrets se não existir (pode não existir sem Docker secrets)
  mkdir -p "$(dirname "$SMTP_PASSWORD_FILE")"
  echo -n "$GMAIL_APP_PASSWORD" > "$SMTP_PASSWORD_FILE"
  chmod 600 "$SMTP_PASSWORD_FILE"
  echo "✅ SMTP configurado com GMAIL_APP_PASSWORD (via env → $SMTP_PASSWORD_FILE)"
else
  echo "⚠️ AVISO: SMTP não configurado - emails não funcionarão"
  echo "   Configure o secret GMAIL_APP_PASSWORD no repositório"
  # Criar arquivo vazio para evitar erro fatal do Alertmanager
  mkdir -p "$(dirname "$SMTP_PASSWORD_FILE")"
  echo -n "" > "$SMTP_PASSWORD_FILE"
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

# =============================================================================
# CORREÇÃO CRÍTICA 30/12/2025: Usar sed ao invés de envsubst
# =============================================================================
# A imagem prom/alertmanager:v0.29.0 é baseada em BusyBox que NÃO inclui envsubst
# (requer pacote GNU gettext). O container falharia com "envsubst: not found".
# 
# Solução enterprise: usar sed para substituição de variáveis (disponível em BusyBox).
# sed -e 's/pattern/replacement/g' substitui todas as ocorrências.
# Usamos | como delimitador pois emails contêm @ que poderia conflitar com /.
#
# Ref: CLAUDE.md Regra 6 - SEM workarounds, usar ferramentas disponíveis
# =============================================================================
sed -e "s|\${SMTP_USER}|${SMTP_USER}|g" \
    -e "s|\${SMTP_FROM}|${SMTP_FROM}|g" \
    -e "s|\${ALERT_EMAIL}|${ALERT_EMAIL}|g" \
    "$CONFIG_TEMPLATE" > "$CONFIG_OUTPUT"

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

# =============================================================================
# FASE 5: Iniciar Alertmanager com argumentos padrão da imagem
# =============================================================================
# CORREÇÃO CRÍTICA 30/12/2025: Quando o entrypoint é sobrescrito, o CMD padrão
# da imagem prom/alertmanager é perdido. O CMD original é:
#   ["--config.file=/etc/alertmanager/alertmanager.yml", "--storage.path=/alertmanager"]
#
# Sem --storage.path=/alertmanager, o Alertmanager usa 'data/' relativo ao WORKDIR,
# resultando em /alertmanager/data/ ao invés de /alertmanager. Isso:
# - Perde dados existentes (silences, notification state) no path original
# - Quebra compatibilidade com o volume montado em /alertmanager
#
# Ref: https://github.com/prometheus/alertmanager/blob/main/Dockerfile
# Ref: CLAUDE.md Regra 6 - SEM workarounds, manter comportamento enterprise
exec /bin/alertmanager \
  --config.file="$CONFIG_OUTPUT" \
  --storage.path=/alertmanager \
  "$@"
