#!/bin/bash
# =============================================================================
# Script de Backup Full MariaDB - Alice Enterprise Platform (ERPNext)
# =============================================================================
# Executa backup completo com mariabackup + compressão + streaming
#
# Regra 10: Documentação PT-BR
# =============================================================================

set -e

BACKUP_DIR="/var/backups/mariadb/full"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/erpnext_full_$DATE.xbstream.gz"
LOG_FILE="/var/log/mariabackup/full_$DATE.log"

echo "=================================================="
echo "  ERPNext - Backup Full MariaDB"
echo "  Data: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Arquivo: $BACKUP_FILE"
echo "=================================================="

# Criar diretório se não existir
mkdir -p "$BACKUP_DIR"

# Executar backup com streaming e compressão
echo "[INFO] Iniciando backup full..."
mariabackup --backup \
    --stream=xbstream \
    --host=erpnext-mariadb \
    --user=root \
    --password="$MYSQL_ROOT_PASSWORD" \
    --parallel=4 \
    2>"$LOG_FILE" | pigz -p 4 > "$BACKUP_FILE"

# Verificar resultado
if [ -f "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "[OK] Backup full concluído: $BACKUP_FILE ($SIZE)"
    
    # Limpar backups incrementais antigos (novo full = base nova)
    rm -rf /var/backups/mariadb/incremental/*
    echo "[INFO] Backups incrementais anteriores removidos."
else
    echo "[ERRO] Falha no backup!"
    exit 1
fi

echo "=================================================="
echo "  Backup Full Concluído!"
echo "=================================================="
