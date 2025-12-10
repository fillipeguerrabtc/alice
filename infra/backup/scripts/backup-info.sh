#!/bin/bash
# =============================================================================
# Script de Informações de Backup - Alice Enterprise Platform
# =============================================================================
# Retorna informações detalhadas dos backups em formato JSON
# Usado pela API do observability-service para dashboard
#
# Uso: backup-info.sh [--json|--text]
#
# Regra 10: Documentação PT-BR
# =============================================================================

set -e

FORMAT="${1:---json}"
# Compat: default "alice" mantém alinhamento com pgbackrest.conf; variável permite override
STANZA="${PGBACKREST_STANZA:-alice}"

case $FORMAT in
    --json)
        pgbackrest info --stanza=$STANZA --output=json
        ;;
    --text)
        echo "=================================================="
        echo "  Alice Enterprise - Status dos Backups"
        echo "  Data: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "=================================================="
        echo ""
        pgbackrest info --stanza=$STANZA
        ;;
    *)
        echo "[ERRO] Formato inválido: $FORMAT"
        echo "Uso: backup-info.sh [--json|--text]"
        exit 1
        ;;
esac
