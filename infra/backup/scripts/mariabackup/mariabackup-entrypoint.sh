#!/bin/bash
# =============================================================================
# Entrypoint Mariabackup - Alice Enterprise Platform (ERPNext)
# =============================================================================
# Configura cron jobs para backup automático do MariaDB
#
# Regra 10: Documentação PT-BR
# =============================================================================

set -e

echo "=================================================="
echo "  Mariabackup Enterprise - ERPNext"
echo "  Inicializando backup enterprise..."
echo "=================================================="

# Verificar variáveis obrigatórias
if [ -z "$MYSQL_ROOT_PASSWORD" ]; then
    echo "[ERRO] MYSQL_ROOT_PASSWORD não está definida!"
    exit 1
fi

# Aguardar MariaDB estar pronto
echo "[INFO] Aguardando MariaDB..."
until mysqladmin ping -h erpnext-mariadb -u root -p"$MYSQL_ROOT_PASSWORD" --silent 2>/dev/null; do
    echo "[INFO] MariaDB não está pronto, aguardando 5s..."
    sleep 5
done
echo "[OK] MariaDB está pronto!"

# Configurar cron jobs
echo "[INFO] Configurando cron jobs..."
cat > /etc/cron.d/mariabackup << EOF
# Backup Full semanal (Domingo às 2h UTC)
0 2 * * 0 root /usr/local/bin/mariabackup-full.sh >> /var/log/mariabackup/cron.log 2>&1

# Backup Incremental diário (3h UTC, exceto Domingo)
0 3 * * 1-6 root /usr/local/bin/mariabackup-incremental.sh >> /var/log/mariabackup/cron.log 2>&1

# Limpeza de backups antigos (Domingo às 4h UTC)
0 4 * * 0 root /usr/local/bin/mariabackup-cleanup.sh >> /var/log/mariabackup/cron.log 2>&1
EOF

chmod 0644 /etc/cron.d/mariabackup

echo "[OK] Cron jobs configurados!"
echo ""
echo "  - Full: Domingo às 2h UTC"
echo "  - Incremental: Diário às 3h UTC (Seg-Sáb)"
echo "  - Limpeza: Domingo às 4h UTC"
echo ""
echo "=================================================="
echo "  Mariabackup pronto para operação!"
echo "=================================================="

exec "$@"
