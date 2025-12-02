#!/bin/bash
# =============================================================================
# Script de Backup MariaDB - ERPNext
# =============================================================================
# Descrição: Backup automatizado do banco MariaDB do ERPNext
# Executado pelo Ofelia scheduler diariamente às 3h30 UTC
# Produção: Hetzner Cloud
#
# Documentação PT-BR (Regra 10 replit.md)
# =============================================================================

set -e

# Configurações
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS="${RETENTION_DAYS:-7}"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ERPNext - Backup MariaDB${NC}"
echo -e "${GREEN}  Data: $(date)${NC}"
echo -e "${GREEN}========================================${NC}"

# Criar diretório de backup se não existir
mkdir -p "$BACKUP_DIR/mariadb"

# Nome do arquivo de backup
BACKUP_FILE="$BACKUP_DIR/mariadb/erpnext_mariadb_$DATE.sql.gz"

# Obter senha do ambiente
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-}"

if [ -z "$MYSQL_ROOT_PASSWORD" ]; then
    echo -e "${RED}✗ MYSQL_ROOT_PASSWORD não está definida${NC}"
    exit 1
fi

# Executar backup com compressão
echo -e "\n${YELLOW}[1/3] Executando mysqldump...${NC}"
mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --all-databases --single-transaction | gzip > "$BACKUP_FILE"

if [ -f "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✓ Backup concluído: $BACKUP_FILE ($SIZE)${NC}"
else
    echo -e "${RED}✗ Falha no backup - arquivo vazio ou não criado${NC}"
    exit 1
fi

# Limpeza de backups antigos
echo -e "\n${YELLOW}[2/3] Limpando backups antigos (>$RETENTION_DAYS dias)...${NC}"
DELETED=$(find "$BACKUP_DIR/mariadb" -name "erpnext_mariadb_*.sql.gz" -type f -mtime +$RETENTION_DAYS -delete -print | wc -l)
echo -e "${GREEN}✓ $DELETED arquivos antigos removidos${NC}"

# Resumo
echo -e "\n${YELLOW}[3/3] Resumo do backup:${NC}"
echo -e "  Arquivo: $BACKUP_FILE"
echo -e "  Tamanho: $SIZE"
echo -e "  Retenção: $RETENTION_DAYS dias"

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  Backup MariaDB concluído!${NC}"
echo -e "${GREEN}========================================${NC}"
