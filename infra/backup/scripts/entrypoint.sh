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

# ==========================================================================
# CORREÇÃO 02/01/2026: Criar stanza SEMPRE (idempotente)
# ==========================================================================
# PROBLEMA ANTERIOR: Verificação com 'grep -q "status"' era falha
# pgbackrest info retorna "status" mesmo sem stanza real
# Resultado: stanza nunca era criada, archive-push falhava
#
# SOLUÇÃO: Verificar se arquivo archive.info existe (prova real)
# stanza-create é idempotente - pode rodar múltiplas vezes sem problema
# ==========================================================================

ARCHIVE_INFO="/var/lib/pgbackrest/archive/$STANZA/archive.info"

echo "[INFO] Verificando stanza '$STANZA'..."
if [ -f "$ARCHIVE_INFO" ]; then
    echo "[OK] Stanza '$STANZA' já existe (archive.info encontrado)"
else
    echo "[INFO] Criando stanza '$STANZA' (archive.info não existe)..."
    
    # stanza-create precisa do pg1-path para ler pg_control
    # PostgreSQL já deve estar rodando neste ponto
    if pgbackrest --stanza="$STANZA" stanza-create 2>&1; then
        echo "[OK] Stanza criada com sucesso!"
    else
        echo "[ERRO] Falha ao criar stanza. Verificando detalhes..."
        pgbackrest --stanza="$STANZA" info 2>&1 || true
        
        # Tentar stanza-upgrade se stanza parcial existir
        echo "[INFO] Tentando stanza-upgrade..."
        if pgbackrest --stanza="$STANZA" stanza-upgrade 2>&1; then
            echo "[OK] Stanza atualizada com sucesso!"
        else
            # ==========================================================================
            # CORREÇÃO 02/01/2026: FAIL-FAST obrigatório (Regra 6 CLAUDE.md)
            # ==========================================================================
            # PROBLEMA ANTERIOR: "Continuando mesmo assim" violava Regra 6
            # Deploy continuava sem backup funcional - inaceitável em produção
            # SOLUÇÃO: Falhar imediatamente se stanza não puder ser criada
            # ==========================================================================
            echo "[ERRO CRÍTICO] stanza-upgrade também falhou"
            echo "[ERRO] FAIL-FAST: Backup enterprise OBRIGATÓRIO (Regra 6 CLAUDE.md)"
            echo "[ERRO] Não é permitido continuar sem backup funcional"
            echo "[ERRO] Verifique:"
            echo "       1. PostgreSQL está rodando e acessível"
            echo "       2. pg_control existe em PGDATA"
            echo "       3. Variáveis PGHOST, PGPASSWORD estão configuradas"
            echo "       4. Permissões em /var/lib/pgbackrest"
            exit 1
        fi
    fi
fi

# Verificar integridade final
echo "[INFO] Verificando integridade da stanza..."
# CORREÇÃO 02/01/2026: Retry com timeout para primeiro deploy
# No primeiro deploy, PostgreSQL pode ainda estar criando arquivos WAL
MAX_CHECK_RETRIES=5
CHECK_RETRY=0
CHECK_SUCCESS=false

while [ $CHECK_RETRY -lt $MAX_CHECK_RETRIES ]; do
    CHECK_RETRY=$((CHECK_RETRY + 1))
    echo "[INFO] Tentativa $CHECK_RETRY de $MAX_CHECK_RETRIES..."
    
    if pgbackrest --stanza="$STANZA" check 2>&1; then
        echo "[OK] Stanza verificada com sucesso!"
        CHECK_SUCCESS=true
        break
    else
        if [ $CHECK_RETRY -lt $MAX_CHECK_RETRIES ]; then
            echo "[WARN] Verificação falhou, aguardando 10s antes de tentar novamente..."
            sleep 10
        fi
    fi
done

if [ "$CHECK_SUCCESS" != "true" ]; then
    # ==========================================================================
    # CORREÇÃO 02/01/2026: FAIL-FAST obrigatório (Regra 6 CLAUDE.md)
    # ==========================================================================
    echo "[ERRO CRÍTICO] Verificação da stanza falhou após $MAX_CHECK_RETRIES tentativas"
    echo "[ERRO] FAIL-FAST: pgBackRest check é obrigatório para garantir backup funcional"
    echo "[ERRO] Verifique:"
    echo "       1. PostgreSQL está rodando com archive_mode=on"
    echo "       2. archive_command está configurado corretamente"
    echo "       3. WAL archiving está funcionando"
    pgbackrest --stanza="$STANZA" info 2>&1 || true
    exit 1
fi

echo "=================================================="
echo "  pgBackRest pronto para operação!"
echo "  Stanza: $STANZA"
echo "  Modo: ${1:-archive-push}"
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