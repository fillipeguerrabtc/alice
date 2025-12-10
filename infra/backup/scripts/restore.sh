#!/bin/bash
# =============================================================================
# Script de Restore - Alice Enterprise Platform
# =============================================================================
# Restaura backup PostgreSQL com suporte a PITR (Point-in-Time Recovery)
#
# Uso:
#   restore.sh                              # Restaura último backup
#   restore.sh --target="2025-12-02 14:30"  # Restaura para momento específico
#   restore.sh --set=20251202-123456F       # Restaura backup específico
#   restore.sh --delta                      # Restaura apenas arquivos alterados
#
# ATENÇÃO: Este script PARA o PostgreSQL e restaura os dados!
# Use com cuidado em produção.
#
# Regra 10: Documentação PT-BR
# =============================================================================

set -e

# Compat: default "alice" mantém alinhamento com pgbackrest.conf; variável permite override
STANZA="${PGBACKREST_STANZA:-alice}"
TARGET_TIME=""
BACKUP_SET=""
DELTA_MODE=false
REPO=1

# Parse argumentos
while [[ $# -gt 0 ]]; do
    case $1 in
        --target=*)
            TARGET_TIME="${1#*=}"
            shift
            ;;
        --set=*)
            BACKUP_SET="${1#*=}"
            shift
            ;;
        --delta)
            DELTA_MODE=true
            shift
            ;;
        --repo=*)
            REPO="${1#*=}"
            shift
            ;;
        *)
            echo "[ERRO] Argumento desconhecido: $1"
            exit 1
            ;;
    esac
done

echo "=================================================="
echo "  Alice Enterprise - Restore PostgreSQL"
echo "  Data: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Stanza: $STANZA"
echo "  Repositório: $REPO"
[ -n "$TARGET_TIME" ] && echo "  Target Time: $TARGET_TIME"
[ -n "$BACKUP_SET" ] && echo "  Backup Set: $BACKUP_SET"
$DELTA_MODE && echo "  Modo Delta: Sim"
echo "=================================================="

# Confirmar operação
echo ""
echo "[AVISO] Este comando vai PARAR o PostgreSQL e restaurar os dados!"
echo "[AVISO] Todos os dados após o ponto de restore serão PERDIDOS!"
echo ""
read -p "Deseja continuar? (digite 'sim' para confirmar): " CONFIRM

if [ "$CONFIRM" != "sim" ]; then
    echo "[CANCELADO] Restore cancelado pelo usuário."
    exit 0
fi

# Montar comando de restore
RESTORE_CMD="pgbackrest --stanza=$STANZA --repo=$REPO"

# Adicionar opções
if [ -n "$TARGET_TIME" ]; then
    RESTORE_CMD="$RESTORE_CMD --type=time --target=\"$TARGET_TIME\" --target-action=promote"
elif [ -n "$BACKUP_SET" ]; then
    RESTORE_CMD="$RESTORE_CMD --set=$BACKUP_SET"
fi

if $DELTA_MODE; then
    RESTORE_CMD="$RESTORE_CMD --delta"
fi

RESTORE_CMD="$RESTORE_CMD restore"

echo ""
echo "[INFO] Executando restore..."
echo "[CMD] $RESTORE_CMD"
echo ""

# Executar restore
eval $RESTORE_CMD

echo ""
echo "=================================================="
echo "  Restore Concluído!"
echo "  PostgreSQL precisa ser reiniciado para aplicar."
echo "=================================================="
