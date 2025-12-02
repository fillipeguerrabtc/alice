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
if [ -z "$PGBACKREST_CIPHER_PASS" ]; then
    echo "[ERRO] PGBACKREST_CIPHER_PASS não está definida!"
    exit 1
fi

# Aguardar PostgreSQL estar pronto
echo "[INFO] Aguardando PostgreSQL..."
until pg_isready -h alice-postgres -p 5432 -U alice 2>/dev/null; do
    echo "[INFO] PostgreSQL não está pronto, aguardando 5s..."
    sleep 5
done
echo "[OK] PostgreSQL está pronto!"

# Verificar se stanza existe, senão criar
echo "[INFO] Verificando stanza 'alice'..."
if ! pgbackrest info --stanza=alice --output=json 2>/dev/null | grep -q '"status":'; then
    echo "[INFO] Criando stanza 'alice'..."
    pgbackrest --stanza=alice stanza-create
    echo "[OK] Stanza criada com sucesso!"
else
    echo "[OK] Stanza 'alice' já existe."
fi

# Verificar integridade da stanza
echo "[INFO] Verificando integridade da stanza..."
pgbackrest --stanza=alice check || {
    echo "[AVISO] Verificação falhou, tentando upgrade da stanza..."
    pgbackrest --stanza=alice stanza-upgrade
}

echo "=================================================="
echo "  pgBackRest pronto para operação!"
echo "  Modo: $1"
echo "=================================================="

# Executar comando passado
exec "$@"
