#!/bin/bash
# =============================================================================
# Script de Backup Full - Alice Enterprise Platform
# =============================================================================
# Executa backup completo com pgBackRest para ambos repositórios
# (local + Hetzner Object Storage offsite)
#
# Uso: backup-full.sh [--repo=1|2|all]
#
# Regra 10: Documentação PT-BR
# Regra 11: Seguir docs oficiais pgBackRest
# =============================================================================

set -e

REPO="${1:-all}"
STANZA="alice"
LOG_FILE="/var/log/pgbackrest/backup-full-$(date +%Y%m%d_%H%M%S).log"

echo "=================================================="
echo "  Alice Enterprise - Backup Full PostgreSQL"
echo "  Data: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Stanza: $STANZA"
echo "  Repositório: $REPO"
echo "=================================================="

# Função para executar backup
run_backup() {
    local repo=$1
    echo "[INFO] Iniciando backup full no repositório $repo..."
    
    pgbackrest --stanza=$STANZA --type=full --repo=$repo backup 2>&1 | tee -a "$LOG_FILE"
    
    if [ ${PIPESTATUS[0]} -eq 0 ]; then
        echo "[OK] Backup full concluído no repositório $repo!"
    else
        echo "[ERRO] Falha no backup do repositório $repo!"
        return 1
    fi
}

# Executar backup conforme repositório selecionado
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
        echo "Uso: backup-full.sh [--repo=1|2|all]"
        exit 1
        ;;
esac

# Mostrar informações do backup
echo ""
echo "=================================================="
echo "  Resumo dos Backups:"
echo "=================================================="
pgbackrest info --stanza=$STANZA

echo ""
echo "=================================================="
echo "  Backup Full Concluído!"
echo "  Log: $LOG_FILE"
echo "=================================================="
