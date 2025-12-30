#!/bin/bash
# =============================================================================
# Entrypoint pgBackRest - Alice Enterprise Platform
# =============================================================================
# Script de inicialização do container pgBackRest
# Configura stanza e inicia serviço de arquivamento WAL
#
# Regra 10: Documentação PT-BR
# =============================================================================

set -euo pipefail

echo "=================================================="
echo "  pgBackRest Enterprise - Alice Platform"
echo "  Inicializando backup enterprise..."
echo "=================================================="

# Verificar variáveis obrigatórias
if [ -z "$PGBACKREST_REPO1_CIPHER_PASS" ]; then
    echo "[ERRO] PGBACKREST_REPO1_CIPHER_PASS não está definida!"
    exit 1
fi

# Usar variável de ambiente para stanza (default: alice_prod)
STANZA="${PGBACKREST_STANZA:-alice_prod}"

# ==========================================================================
# CORREÇÃO 30/12/2025: Usar variáveis padrão PostgreSQL/libpq
# ==========================================================================
# pgBackRest usa libpq para conexões SQL. Variáveis padrão:
# PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
# Ref: https://www.postgresql.org/docs/current/libpq-envars.html
# ==========================================================================

# Aguardar PostgreSQL estar pronto via rede Docker
echo "[INFO] Aguardando PostgreSQL..."
PG_HOST="${PGHOST:-postgres}"
PG_PORT="${PGPORT:-5432}"
PG_USER="${PGUSER:-alice}"

until pg_isready -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" 2>/dev/null; do
    echo "[INFO] PostgreSQL não está pronto, aguardando 5s..."
    sleep 5
done
echo "[OK] PostgreSQL está pronto!"

# Verificar que as variáveis de ambiente libpq estão configuradas
if [ -z "${PGHOST:-}" ]; then
    echo "[WARN] PGHOST não definido, usando 'postgres' como padrão"
    export PGHOST="postgres"
fi
if [ -z "${PGPASSWORD:-}" ]; then
    echo "[ERRO] PGPASSWORD não está definido! pgBackRest requer autenticação."
    exit 1
fi

echo "[INFO] Conexão libpq configurada: PGHOST=$PGHOST, PGPORT=${PGPORT:-5432}, PGUSER=${PGUSER:-alice}"

# Verificar se stanza existe, senão criar
echo "[INFO] Verificando stanza '$STANZA'..."
if ! pgbackrest info --stanza="$STANZA" --output=json 2>/dev/null | grep -q '"status":'; then
    echo "[INFO] Criando stanza '$STANZA'..."
    pgbackrest --stanza="$STANZA" stanza-create
    echo "[OK] Stanza criada com sucesso!"
else
    echo "[OK] Stanza '$STANZA' já existe."
fi

# Verificar integridade da stanza
echo "[INFO] Verificando integridade da stanza..."
pgbackrest --stanza="$STANZA" check || {
    echo "[AVISO] Verificação falhou, tentando upgrade da stanza..."
    pgbackrest --stanza="$STANZA" stanza-upgrade
}

echo "=================================================="
echo "  pgBackRest pronto para operação!"
echo "  Stanza: $STANZA"
echo "  Modo: $1"
echo "=================================================="

# Executar comando passado COM stanza explícito
# Bug fix: pgBackRest requer --stanza= explícito em todos os comandos
if [ $# -eq 0 ]; then
    # Se não houver argumentos, usar archive-push como padrão
    exec pgbackrest --stanza="$STANZA" archive-push
else
    # Se houver argumentos, adicionar --stanza= antes do primeiro argumento
    # Exemplo: archive-push -> pgbackrest --stanza=alice_prod archive-push
    exec pgbackrest --stanza="$STANZA" "$@"
fi