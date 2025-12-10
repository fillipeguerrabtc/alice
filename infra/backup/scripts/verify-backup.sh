#!/bin/bash
# =============================================================================
# Script de Verificação de Backup - Alice Enterprise Platform
# =============================================================================
# Verifica integridade dos backups (checksums, arquivos WAL, etc.)
# Deve ser executado mensalmente como parte do drill de restore
#
# Regra 10: Documentação PT-BR
# Regra 16: Best practices (verificação de integridade)
# =============================================================================

set -e

# Compat: default "alice_prod" mantém alinhamento com pgbackrest.conf; variável permite override
STANZA="${PGBACKREST_STANZA:-alice_prod}"
REPO="${1:-1}"

echo "=================================================="
echo "  Alice Enterprise - Verificação de Backup"
echo "  Data: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Stanza: $STANZA"
echo "  Repositório: $REPO"
echo "=================================================="

echo ""
echo "[INFO] Verificando integridade dos backups..."
pgbackrest --stanza=$STANZA --repo=$REPO verify

echo ""
echo "[INFO] Verificando arquivos WAL..."
pgbackrest --stanza=$STANZA --repo=$REPO check

echo ""
echo "=================================================="
echo "  Verificação Concluída!"
echo "  Todos os backups estão íntegros."
echo "=================================================="
