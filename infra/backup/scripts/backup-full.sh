#!/bin/bash
# =============================================================================
# Script de Backup Full - Alice Enterprise Platform
# =============================================================================
# Executa backup completo com pgBackRest para repositório local
# STORAGE: Volume Local Hetzner (/opt/alice/backups) - SEM S3 EXTERNO
#
# Uso: backup-full.sh
#
# Regra 10: Documentação PT-BR
# Regra 11: Seguir docs oficiais pgBackRest
#
# Autor: Fillipe Guerra
# Data: 05 de Dezembro de 2025
# =============================================================================

set -e

# Compat: default "alice_prod" mantém alinhamento com pgbackrest.conf; variável permite override
STANZA="${PGBACKREST_STANZA:-alice_prod}"
LOG_FILE="/var/log/pgbackrest/backup-full-$(date +%Y%m%d_%H%M%S).log"

echo "=================================================="
echo "  Alice Enterprise - Backup Full PostgreSQL"
echo "  Data: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Stanza: $STANZA"
echo "  Storage: Volume Local Hetzner"
echo "=================================================="

# Executar backup
echo "[INFO] Iniciando backup full no volume local..."

pgbackrest --stanza=$STANZA --type=full backup 2>&1 | tee -a "$LOG_FILE"

if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo "[OK] Backup full concluído com sucesso!"
else
    echo "[ERRO] Falha no backup!"
    exit 1
fi

# Mostrar informações do backup
echo ""
echo "=================================================="
echo "  Resumo do Backup:"
echo "=================================================="
pgbackrest info --stanza=$STANZA

echo ""
echo "=================================================="
echo "  Backup Full Concluído!"
echo "  Log: $LOG_FILE"
echo "  Local: /opt/alice/backups/postgresql"
echo "=================================================="
