#!/bin/bash
# =============================================================================
# Entrypoint pgBackRest - Alice Enterprise Platform
# =============================================================================
# Script de inicialização do container pgBackRest
# Configura stanza e inicia serviço de arquivamento WAL
#
# Regra 10: Documentação PT-BR
# =============================================================================

set -e

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

# Aguardar PostgreSQL estar pronto
echo "[INFO] Aguardando PostgreSQL..."
PG_HOST="${PGBACKREST_PG1_HOST:-postgres}"
PG_PORT="${PGBACKREST_PG1_PORT:-5432}"
PG_USER="${PGUSER:-alice}"

until pg_isready -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" 2>/dev/null; do
    echo "[INFO] PostgreSQL não está pronto, aguardando 5s..."
    sleep 5
done
echo "[OK] PostgreSQL está pronto!"

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