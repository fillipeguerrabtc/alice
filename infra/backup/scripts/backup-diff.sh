#!/bin/bash
# =============================================================================
# Script de Backup Diferencial - Alice Enterprise Platform
# =============================================================================
# Executa backup diferencial (apenas mudanças desde o último full)
# Muito mais rápido que backup full, ideal para execução diária
#
# Uso: backup-diff.sh [--repo=1|2|all]
#
# Regra 10: Documentação PT-BR
# =============================================================================

set -e

REPO="${1:-all}"
STANZA="alice"
LOG_FILE="/var/log/pgbackrest/backup-diff-$(date +%Y%m%d_%H%M%S).log"

echo "=================================================="
echo "  Alice Enterprise - Backup Diferencial"
echo "  Data: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Stanza: $STANZA"
echo "=================================================="

run_backup() {
    local repo=$1
    echo "[INFO] Iniciando backup diferencial no repositório $repo..."
    
    pgbackrest --stanza=$STANZA --type=diff --repo=$repo backup 2>&1 | tee -a "$LOG_FILE"
    
    if [ ${PIPESTATUS[0]} -eq 0 ]; then
        echo "[OK] Backup diferencial concluído no repositório $repo!"
    else
        echo "[ERRO] Falha no backup do repositório $repo!"
        return 1
    fi
}

case $REPO in
    1)
        run_backup 1
        ;;
    2)
        run_backup 2
        ;;
    all)
        run_backup 1
        run_backup 2
        ;;
    *)
        echo "[ERRO] Repositório inválido: $REPO"
        exit 1
        ;;
esac

pgbackrest info --stanza=$STANZA

echo "=================================================="
echo "  Backup Diferencial Concluído!"
echo "=================================================="
