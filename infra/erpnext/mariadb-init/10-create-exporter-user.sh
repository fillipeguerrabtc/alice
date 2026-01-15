#!/usr/bin/env bash
# =============================================================================
# ERPNext (MariaDB) - Observability - mysqld_exporter user (least privilege)
# =============================================================================
# Autor: Fillipe Guerra
# Data: 15 de Janeiro de 2026
#
# Objetivo:
# - Criar usuário dedicado para o Prometheus mysqld_exporter (WS2)
# - Evitar uso de root para scraping de métricas
#
# Referências:
# - https://github.com/prometheus/mysqld_exporter
# - MariaDB docker entrypoint: /docker-entrypoint-initdb.d
# =============================================================================

set -euo pipefail

if [[ -z "${MYSQL_ROOT_PASSWORD:-}" ]]; then
  echo "ERRO: MYSQL_ROOT_PASSWORD não definido (bootstrap MariaDB)."
  exit 1
fi

if [[ -z "${ERPNEXT_MYSQL_EXPORTER_PASSWORD:-}" ]]; then
  echo "ERRO: ERPNEXT_MYSQL_EXPORTER_PASSWORD não definido (credencial do exporter)."
  exit 1
fi

EXPORTER_USER="${ERPNEXT_MYSQL_EXPORTER_USER:-erpnext_exporter}"

echo "Criando usuário de métricas '${EXPORTER_USER}' (least privilege) ..."

mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS '${EXPORTER_USER}'@'%' IDENTIFIED BY '${ERPNEXT_MYSQL_EXPORTER_PASSWORD}';
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO '${EXPORTER_USER}'@'%';
GRANT SELECT ON performance_schema.* TO '${EXPORTER_USER}'@'%';
FLUSH PRIVILEGES;
SQL

echo "Usuário de métricas '${EXPORTER_USER}' criado com sucesso."

