#!/bin/bash
# Script de Backup Automatizado - Alice Enterprise Platform
# Produção: Hetzner Cloud
# Executar diariamente via cron às 3h da manhã

set -e

# Configurações
BACKUP_DIR="/opt/alice/backups"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Alice Enterprise - Backup Iniciado${NC}"
echo -e "${GREEN}  Data: $(date)${NC}"
echo -e "${GREEN}========================================${NC}"

# Criar diretório de backup se não existir
mkdir -p "$BACKUP_DIR"

# =============================================
# BACKUP POSTGRESQL (Alice Database)
# =============================================
echo -e "\n${YELLOW}[1/4] Backup PostgreSQL (Alice)...${NC}"

POSTGRES_BACKUP="$BACKUP_DIR/alice_postgres_$DATE.sql.gz"

docker exec alice-postgres pg_dump -U alice alice_db | gzip > "$POSTGRES_BACKUP"

if [ -f "$POSTGRES_BACKUP" ]; then
    SIZE=$(du -h "$POSTGRES_BACKUP" | cut -f1)
    echo -e "${GREEN}✓ PostgreSQL backup concluído: $POSTGRES_BACKUP ($SIZE)${NC}"
else
    echo -e "${RED}✗ Falha no backup PostgreSQL${NC}"
    exit 1
fi

# =============================================
# BACKUP MARIADB (ERPNext Database)
# =============================================
echo -e "\n${YELLOW}[2/4] Backup MariaDB (ERPNext)...${NC}"

MARIADB_BACKUP="$BACKUP_DIR/erpnext_mariadb_$DATE.sql.gz"

# Ler senha do container
MYSQL_ROOT_PASSWORD=$(docker exec erpnext-mariadb printenv MYSQL_ROOT_PASSWORD 2>/dev/null || echo "")

if [ -n "$MYSQL_ROOT_PASSWORD" ]; then
    docker exec erpnext-mariadb mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --all-databases | gzip > "$MARIADB_BACKUP"
    
    if [ -f "$MARIADB_BACKUP" ]; then
        SIZE=$(du -h "$MARIADB_BACKUP" | cut -f1)
        echo -e "${GREEN}✓ MariaDB backup concluído: $MARIADB_BACKUP ($SIZE)${NC}"
    else
        echo -e "${RED}✗ Falha no backup MariaDB${NC}"
    fi
else
    echo -e "${YELLOW}⚠ ERPNext MariaDB não disponível ou sem senha configurada${NC}"
fi

# =============================================
# BACKUP REDIS (ERPNext Cache)
# =============================================
echo -e "\n${YELLOW}[3/4] Backup Redis...${NC}"

REDIS_BACKUP="$BACKUP_DIR/redis_$DATE.rdb"

docker exec erpnext-redis redis-cli BGSAVE 2>/dev/null || true
sleep 2
docker cp erpnext-redis:/data/dump.rdb "$REDIS_BACKUP" 2>/dev/null || true

if [ -f "$REDIS_BACKUP" ]; then
    SIZE=$(du -h "$REDIS_BACKUP" | cut -f1)
    echo -e "${GREEN}✓ Redis backup concluído: $REDIS_BACKUP ($SIZE)${NC}"
else
    echo -e "${YELLOW}⚠ Redis backup não disponível${NC}"
fi

# =============================================
# LIMPEZA DE BACKUPS ANTIGOS
# =============================================
echo -e "\n${YELLOW}[4/4] Limpando backups antigos (>$RETENTION_DAYS dias)...${NC}"

DELETED=$(find "$BACKUP_DIR" -type f -mtime +$RETENTION_DAYS -delete -print | wc -l)
echo -e "${GREEN}✓ $DELETED arquivos antigos removidos${NC}"

# =============================================
# RESUMO FINAL
# =============================================
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  Backup Concluído com Sucesso!${NC}"
echo -e "${GREEN}========================================${NC}"

echo -e "\nArquivos de backup:"
ls -lh "$BACKUP_DIR"/*_$DATE* 2>/dev/null || echo "Nenhum arquivo encontrado"

echo -e "\nEspaço total em backups:"
du -sh "$BACKUP_DIR"

echo -e "\n${GREEN}Próximo passo: Considere copiar para armazenamento externo (S3, Hetzner Storage Box)${NC}"
