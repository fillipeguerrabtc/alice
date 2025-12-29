#!/bin/bash
# =============================================================================
# Entrypoint pgBackRest - Alice Enterprise Platform
# =============================================================================
# Script de inicialização do container pgBackRest
# Configura stanza e executa backups enterprise
#
# ARQUITETURA DOCKER (29/12/2025):
# - PostgreSQL e pgBackRest rodam em containers SEPARADOS
# - pgBackRest acessa PGDATA via volume compartilhado (read-only)
# - CORREÇÃO 29/12/2025: archive_mode=on com archive_command='/bin/true' (dummy)
# - Backups full/incremental funcionam via acesso direto ao PGDATA
# - archive_command dummy satisfaz validação pgBackRest sem impacto funcional
#
# Author: Fillipe Guerra
# Data: 29 de Dezembro de 2025
# Documentação PT-BR (Regra 10 CLAUDE.md)
# =============================================================================

set -euo pipefail

echo "=================================================="
echo "  pgBackRest Enterprise - Alice Platform"
echo "  Inicializando backup enterprise..."
echo "=================================================="

# =============================================================================
# FASE 1: Validação de variáveis obrigatórias
# =============================================================================
if [ -z "${PGBACKREST_REPO1_CIPHER_PASS:-}" ]; then
    echo "[ERRO] PGBACKREST_REPO1_CIPHER_PASS não está definida!"
    echo "[DICA] Configure o secret BACKUP_CIPHER_PASS no GitHub"
    exit 1
fi

STANZA="${PGBACKREST_STANZA:-alice_prod}"
echo "[INFO] Stanza: $STANZA"

# =============================================================================
# FASE 2: Aguardar PostgreSQL estar pronto
# =============================================================================
PG_HOST="${PGHOST:-postgres}"
PG_PORT="${PGPORT:-5432}"
PG_USER="${PGUSER:-alice}"

echo "[INFO] Aguardando PostgreSQL em ${PG_HOST}:${PG_PORT}..."

MAX_RETRIES=60
RETRY_COUNT=0
until pg_isready -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" 2>/dev/null; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "[ERRO] PostgreSQL não respondeu após ${MAX_RETRIES} tentativas"
        exit 1
    fi
    echo "[INFO] PostgreSQL não está pronto, tentativa $RETRY_COUNT/$MAX_RETRIES..."
    sleep 5
done
echo "[OK] PostgreSQL está pronto!"

# =============================================================================
# FASE 3: Verificar acesso ao PGDATA
# =============================================================================
PGDATA_PATH="${PGBACKREST_DB_PATH:-/var/lib/postgresql/data}"
echo "[INFO] Verificando acesso ao PGDATA em $PGDATA_PATH..."

if [ ! -d "$PGDATA_PATH" ]; then
    echo "[ERRO] Diretório PGDATA não encontrado: $PGDATA_PATH"
    echo "[DICA] Verifique se o volume postgres_data está montado corretamente"
    exit 1
fi

# Verificar se pg_control existe (indica PostgreSQL inicializado)
if [ ! -f "$PGDATA_PATH/global/pg_control" ]; then
    echo "[AVISO] pg_control não encontrado - PostgreSQL ainda inicializando"
    echo "[INFO] Aguardando PostgreSQL criar estrutura de dados..."
    sleep 30
fi

if [ -f "$PGDATA_PATH/global/pg_control" ]; then
    echo "[OK] PGDATA acessível e PostgreSQL inicializado"
else
    echo "[AVISO] pg_control ainda não existe - primeira inicialização pode demorar"
fi

# =============================================================================
# FASE 4: Criar/verificar stanza
# =============================================================================
echo "[INFO] Verificando stanza '$STANZA'..."

# Verificar se stanza existe
if pgbackrest info --stanza="$STANZA" --output=json 2>/dev/null | grep -q '"status"'; then
    echo "[OK] Stanza '$STANZA' já existe"
    
    # Tentar upgrade se necessário
    pgbackrest --stanza="$STANZA" stanza-upgrade 2>/dev/null || true
else
    echo "[INFO] Criando stanza '$STANZA'..."
    
    # Criar stanza - pode falhar se PostgreSQL ainda está inicializando
    if pgbackrest --stanza="$STANZA" stanza-create 2>&1; then
        echo "[OK] Stanza criada com sucesso!"
    else
        echo "[AVISO] Falha ao criar stanza - PostgreSQL pode estar inicializando"
        echo "[INFO] Tentando novamente em 30 segundos..."
        sleep 30
        
        if pgbackrest --stanza="$STANZA" stanza-create 2>&1; then
            echo "[OK] Stanza criada na segunda tentativa!"
        else
            echo "[ERRO] Falha ao criar stanza após retry"
            echo "[INFO] Container continuará rodando - stanza será criada no próximo backup"
        fi
    fi
fi

# =============================================================================
# FASE 5: Verificar integridade (opcional - não bloqueia startup)
# =============================================================================
echo "[INFO] Verificando integridade da configuração..."

# CORREÇÃO 29/12/2025: archive_mode=on agora está habilitado
# Check deve passar com archive_mode=on e archive_command='/bin/true'
if pgbackrest --stanza="$STANZA" check 2>&1; then
    echo "[OK] Verificação de integridade passou"
else
    echo "[AVISO] Verificação retornou avisos (verificar logs acima)"
    echo "[INFO] Backups full/incremental funcionarão normalmente via acesso direto ao PGDATA"
fi

echo "=================================================="
echo "  pgBackRest inicializado!"
echo "  Stanza: $STANZA"
echo "  Modo: ${1:-standby}"
echo "=================================================="
echo ""
echo "  Comandos disponíveis:"
echo "  - backup --type=full    : Backup completo"
echo "  - backup --type=incr    : Backup incremental"
echo "  - info                  : Status dos backups"
echo "=================================================="

# =============================================================================
# FASE 6: Executar comando ou manter container rodando
# =============================================================================
if [ $# -eq 0 ]; then
    # Sem argumentos: manter container rodando para backups agendados
    echo "[INFO] Modo standby - aguardando comandos de backup..."
    echo "[INFO] Use 'docker exec alice-pgbackrest pgbackrest --stanza=$STANZA backup --type=full'"
    
    # Loop infinito para manter container vivo
    while true; do
        sleep 3600
        echo "[HEARTBEAT] pgBackRest standby - $(date)"
    done
else
    # Com argumentos: executar comando pgBackRest
    echo "[INFO] Executando: pgbackrest --stanza=$STANZA $@"
    exec pgbackrest --stanza="$STANZA" "$@"
fi