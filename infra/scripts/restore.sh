#!/bin/bash
# Script de Restore - Alice Enterprise Platform
# Produção: Hetzner Cloud

set -e

# Configurações
BACKUP_DIR="/opt/alice/backups"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  Alice Enterprise - Restore${NC}"
echo -e "${YELLOW}========================================${NC}"

# Verificar argumentos
if [ $# -lt 2 ]; then
    echo -e "${RED}Uso: $0 <tipo> <arquivo_backup>${NC}"
    echo ""
    echo "Tipos disponíveis:"
    echo "  postgres  - Restaurar banco PostgreSQL (Alice)"
    echo "  mariadb   - Restaurar banco MariaDB (ERPNext)"
    echo ""
    echo "Exemplo:"
    echo "  $0 postgres /opt/alice/backups/alice_postgres_20251126.sql.gz"
    echo ""
    echo "Backups disponíveis:"
    ls -la "$BACKUP_DIR"/*.sql.gz 2>/dev/null || echo "  Nenhum backup encontrado"
    exit 1
fi

TYPE=$1
BACKUP_FILE=$2

# Verificar se arquivo existe
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}Erro: Arquivo não encontrado: $BACKUP_FILE${NC}"
    exit 1
fi

# Confirmação
echo -e "\n${YELLOW}⚠️  ATENÇÃO: Esta operação irá SUBSTITUIR os dados atuais!${NC}"
echo -e "Tipo: $TYPE"
echo -e "Arquivo: $BACKUP_FILE"
echo ""
read -p "Tem certeza que deseja continuar? (digite 'sim' para confirmar): " CONFIRM

if [ "$CONFIRM" != "sim" ]; then
    echo -e "${YELLOW}Operação cancelada.${NC}"
    exit 0
fi

case $TYPE in
    postgres)
        echo -e "\n${YELLOW}Restaurando PostgreSQL (Alice)...${NC}"
        
        # Parar serviços que usam o banco
        echo "Parando serviços..."
        docker compose -p alice-app --env-file /opt/alice/app/infra/docker/.env.prod -f /opt/alice/app/infra/docker/stacks/docker-compose.base.yml -f /opt/alice/app/infra/docker/stacks/docker-compose. alice.yml stop alice-auth alice-chat alice-rag alice-training alice-integrations 2>/dev/null || true
        
        # Dropar e recriar banco
        echo "Recriando banco de dados..."
        docker exec alice-postgres psql -U alice -c "DROP DATABASE IF EXISTS alice_db;" postgres
        docker exec alice-postgres psql -U alice -c "CREATE DATABASE alice_db;" postgres
        
        # Restaurar
        echo "Restaurando backup..."
        gunzip -c "$BACKUP_FILE" | docker exec -i alice-postgres psql -U alice alice_db
        
        # Reiniciar serviços
        echo "Reiniciando serviços..."
        docker compose -p alice-app --env-file /opt/alice/app/infra/docker/. env.prod -f /opt/alice/app/infra/docker/stacks/docker-compose.base.yml -f /opt/alice/app/infra/docker/stacks/docker-compose.alice. yml up -d alice-auth alice-chat alice-rag alice-training alice-integrations
        
        echo -e "${GREEN}✓ PostgreSQL restaurado com sucesso!${NC}"
        ;;
        
    mariadb)
        echo -e "\n${YELLOW}Restaurando MariaDB (ERPNext)...${NC}"
        
        # Parar ERPNext
        echo "Parando ERPNext..."
        docker compose -p alice-erpnext --env-file /opt/alice/app/infra/docker/.env.prod -f /opt/alice/app/infra/docker/stacks/docker-compose.base.yml -f /opt/alice/app/infra/docker/stacks/docker-compose. erpnext.yml stop erpnext-frontend erpnext-backend 2>/dev/null || true
        
        # Ler senha
        MYSQL_ROOT_PASSWORD=$(docker exec erpnext-mariadb printenv MYSQL_ROOT_PASSWORD 2>/dev/null || echo "")
        
        if [ -z "$MYSQL_ROOT_PASSWORD" ]; then
            echo -e "${RED}Erro: MYSQL_ROOT_PASSWORD não encontrada${NC}"
            exit 1
        fi
        
        # Restaurar
        echo "Restaurando backup..."
        gunzip -c "$BACKUP_FILE" | docker exec -i erpnext-mariadb mysql -u root -p"$MYSQL_ROOT_PASSWORD"
        
        # Reiniciar ERPNext
        echo "Reiniciando ERPNext..."
        docker compose -p alice-erpnext --env-file /opt/alice/app/infra/docker/.env.prod -f /opt/alice/app/infra/docker/stacks/docker-compose.base.yml -f /opt/alice/app/infra/docker/stacks/docker-compose. erpnext. yml up -d erpnext-frontend erpnext-backend
        
        echo -e "${GREEN}✓ MariaDB restaurado com sucesso!${NC}"
        ;;
        
    *)
        echo -e "${RED}Tipo inválido: $TYPE${NC}"
        echo "Use: postgres ou mariadb"
        exit 1
        ;;
esac

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  Restore Concluído!${NC}"
echo -e "${GREEN}========================================${NC}"
