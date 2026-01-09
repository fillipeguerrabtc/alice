#!/usr/bin/env bash
# =============================================================================
# Script: permissions-config.sh
# Versão: 1.0.0
# Data: 09 de Janeiro de 2026
# Autor: Fillipe Guerra
# =============================================================================
# PROPÓSITO: Single Source of Truth (SSOT) para UIDs, GIDs e permissões
#            de todos os diretórios de dados da plataforma Alice Enterprise.
#
# PROBLEMA RESOLVIDO: Inconsistência entre prepare-production-server.sh e
#                     fix-production-permissions.sh que usavam valores
#                     DIFERENTES para os mesmos diretórios, causando falha
#                     na validação de permissões.
#
# USO:
#   source "${SCRIPT_DIR}/permissions-config.sh"
#   # Usar arrays PERMISSIONS_CONFIG e VALIDATION_EXCEPTIONS
#
# REFERÊNCIAS:
#   - CLAUDE.md Regra 2: Não duplicar código
#   - CLAUDE.md Regra 6: Enterprise-grade, sem hardcoded
#   - CLAUDE.md Regra 7: Identificar causa raiz
#   - docs/PERMISSIONS.md: Documentação completa
# =============================================================================

# =============================================================================
# DIRETÓRIOS BASE
# =============================================================================
readonly ALICE_BASE_DIR="/opt/alice"
readonly ALICE_DATA_DIR="${ALICE_BASE_DIR}/data"
readonly ALICE_LOGS_DIR="${ALICE_BASE_DIR}/logs"
readonly ALICE_BACKUPS_DIR="${ALICE_BASE_DIR}/backups"
readonly ALICE_UPLOADS_DIR="${ALICE_BASE_DIR}/uploads"
readonly ALICE_SECRETS_DIR="${ALICE_BASE_DIR}/secrets"

# =============================================================================
# UIDs/GIDs POR SERVIÇO
# =============================================================================
# NOTA: Estes UIDs são determinados pelas imagens Docker base oficiais
#       e NÃO devem ser alterados sem verificar as imagens correspondentes.
#
# REF: CLAUDE.md Regra 11 (Seguir docs oficiais)
# =============================================================================

# PostgreSQL Alpine (UID 70)
# REF: https://github.com/docker-library/postgres (Alpine variant)
readonly POSTGRES_UID=70
readonly POSTGRES_GID=70

# Redis Alpine (UID 999)
# REF: https://github.com/docker-library/redis
readonly REDIS_UID=999
readonly REDIS_GID=999

# Caddy (UID 1000 - custom build)
# REF: infra/docker/caddy/Dockerfile
readonly CADDY_UID=1000
readonly CADDY_GID=1000

# SearXNG (UID 977)
# REF: https://github.com/searxng/searxng-docker
readonly SEARXNG_UID=977
readonly SEARXNG_GID=977

# Grafana OSS (UID 472)
# REF: https://grafana.com/docs/grafana/latest/setup-grafana/installation/docker/
readonly GRAFANA_UID=472
readonly GRAFANA_GID=472

# Prometheus (UID 65534 - nobody)
# REF: https://prometheus.io/docs/prometheus/latest/installation/
readonly PROMETHEUS_UID=65534
readonly PROMETHEUS_GID=65534

# Jaeger (UID 10001 - distroless)
# REF: https://www.jaegertracing.io/docs/deployment/
readonly JAEGER_UID=10001
readonly JAEGER_GID=10001

# Loki (UID 10001 - distroless)
# REF: https://grafana.com/docs/loki/latest/setup/install/docker/
readonly LOKI_UID=10001
readonly LOKI_GID=10001

# ClickHouse (UID 101)
# REF: https://clickhouse.com/docs/en/getting-started/install
readonly CLICKHOUSE_UID=101
readonly CLICKHOUSE_GID=101

# MariaDB (UID 999 - mysql)
# REF: https://hub.docker.com/_/mariadb
readonly MARIADB_UID=999
readonly MARIADB_GID=999

# ERPNext/Frappe (UID 1000 - frappe)
# REF: https://github.com/frappe/frappe_docker
readonly FRAPPE_UID=1000
readonly FRAPPE_GID=1000

# Node.js containers (UID 1000)
# REF: Node.js official Alpine images
readonly NODE_UID=1000
readonly NODE_GID=1000

# Root (UID 0) - para serviços que requerem root
readonly ROOT_UID=0
readonly ROOT_GID=0

# =============================================================================
# TABELA DE PERMISSÕES ENTERPRISE (SSOT)
# =============================================================================
# Formato: "path:uid:gid:permissions"
#
# PERMISSÕES:
#   700 - rwx------ (owner only, PostgreSQL data dirs obrigatório)
#   755 - rwxr-xr-x (owner rwx, outros rx - padrão para web servers)
#   750 - rwxr-x--- (owner rwx, grupo rx - diretórios sensíveis)
#
# NOTAS IMPORTANTES:
#   - postgres: 700 (OBRIGATÓRIO por PostgreSQL security hardening)
#   - langfuse-db: 700 (PostgreSQL strict mode - NÃO 755!)
#   - caddy: 755 (web server precisa servir certificados - NÃO 700!)
#   - backups/postgresql: 755 (root deve poder ler para restore - NÃO 750!)
#   - secrets: 700 (apenas root pode ler)
#
# REF: CLAUDE.md Regra 6 (Zero hardcoded), Regra 11 (Docs oficiais)
# REF: PostgreSQL 16 docs - https://www.postgresql.org/docs/16/runtime-config-file-locations.html
# REF: Caddy docs - https://caddyserver.com/docs/conventions#file-locations
# =============================================================================
declare -a PERMISSIONS_CONFIG=(
    # =========================================================================
    # INFRA STACK
    # =========================================================================
    
    # PostgreSQL (Alpine UID 70) - CRÍTICO: 700 obrigatório
    "${ALICE_DATA_DIR}/postgres:${POSTGRES_UID}:${POSTGRES_GID}:700"
    
    # pgBackRest Spool (usa mesmo UID do PostgreSQL)
    "${ALICE_DATA_DIR}/pgbackrest-spool:${POSTGRES_UID}:${POSTGRES_GID}:755"
    
    # Redis Alice (UID 999)
    "${ALICE_DATA_DIR}/redis-alice:${REDIS_UID}:${REDIS_GID}:755"
    
    # Caddy (UID 1000) - CORREÇÃO: 755 (não 700!)
    # Web server precisa servir certificados SSL públicos
    "${ALICE_DATA_DIR}/caddy:${CADDY_UID}:${CADDY_GID}:755"
    "${ALICE_DATA_DIR}/caddy-config:${CADDY_UID}:${CADDY_GID}:755"
    
    # SearXNG (UID 977)
    "${ALICE_DATA_DIR}/searxng-config:${SEARXNG_UID}:${SEARXNG_GID}:755"
    
    # MinIO (root) - requer root para bind em portas baixas
    "${ALICE_DATA_DIR}/minio:${ROOT_UID}:${ROOT_GID}:755"
    
    # Qdrant (root) - banco vetorial
    "${ALICE_DATA_DIR}/qdrant:${ROOT_UID}:${ROOT_GID}:755"
    
    # =========================================================================
    # OBSERVABILITY STACK
    # =========================================================================
    
    # Jaeger (UID 10001 - distroless)
    "${ALICE_DATA_DIR}/jaeger:${JAEGER_UID}:${JAEGER_GID}:755"
    
    # Prometheus (UID 65534 - nobody)
    "${ALICE_DATA_DIR}/prometheus:${PROMETHEUS_UID}:${PROMETHEUS_GID}:755"
    
    # Grafana (UID 472)
    "${ALICE_DATA_DIR}/grafana:${GRAFANA_UID}:${GRAFANA_GID}:755"
    
    # Loki (UID 10001 - distroless)
    "${ALICE_DATA_DIR}/loki:${LOKI_UID}:${LOKI_GID}:755"
    
    # Langfuse DB (PostgreSQL Alpine) - CORREÇÃO: 700 (não 755!)
    # PostgreSQL requer modo restrito para data directory
    "${ALICE_DATA_DIR}/langfuse-db:${POSTGRES_UID}:${POSTGRES_GID}:700"
    
    # ClickHouse (UID 101)
    "${ALICE_DATA_DIR}/clickhouse:${CLICKHOUSE_UID}:${CLICKHOUSE_GID}:755"
    
    # Vector (root) - agregador de logs
    "${ALICE_DATA_DIR}/vector:${ROOT_UID}:${ROOT_GID}:755"
    
    # =========================================================================
    # ERPNEXT STACK
    # =========================================================================
    
    # ERPNext Sites (Frappe UID 1000)
    "${ALICE_DATA_DIR}/erpnext-sites:${FRAPPE_UID}:${FRAPPE_GID}:755"
    
    # ERPNext MariaDB (UID 999)
    "${ALICE_DATA_DIR}/erpnext-mariadb:${MARIADB_UID}:${MARIADB_GID}:755"
    
    # ERPNext Redis Cache/Queue (UID 999)
    "${ALICE_DATA_DIR}/erpnext-redis-cache:${REDIS_UID}:${REDIS_GID}:755"
    "${ALICE_DATA_DIR}/erpnext-redis-queue:${REDIS_UID}:${REDIS_GID}:755"
    
    # =========================================================================
    # LOGS
    # =========================================================================
    
    # Logs Caddy
    "${ALICE_LOGS_DIR}/caddy:${CADDY_UID}:${CADDY_GID}:755"
    
    # Logs ERPNext
    "${ALICE_LOGS_DIR}/erpnext:${FRAPPE_UID}:${FRAPPE_GID}:755"
    
    # Logs ClickHouse
    "${ALICE_LOGS_DIR}/clickhouse:${CLICKHOUSE_UID}:${CLICKHOUSE_GID}:755"
    
    # =========================================================================
    # BACKUPS
    # =========================================================================
    
    # Backups PostgreSQL (pgBackRest) - CORREÇÃO: 755 (não 750!)
    # Root deve poder ler backups para restore manual se necessário
    "${ALICE_BACKUPS_DIR}/postgresql:${POSTGRES_UID}:${POSTGRES_GID}:755"
    
    # =========================================================================
    # UPLOADS
    # =========================================================================
    
    # Uploads (microsserviços Alice - Node.js UID 1000)
    "${ALICE_UPLOADS_DIR}:${NODE_UID}:${NODE_GID}:755"
    
    # =========================================================================
    # SECRETS
    # =========================================================================
    
    # Secrets (apenas root pode ler)
    "${ALICE_SECRETS_DIR}:${ROOT_UID}:${ROOT_GID}:700"
)

# =============================================================================
# SISTEMA DE EXCEÇÕES PARA VALIDAÇÃO RECURSIVA
# =============================================================================
# PROPÓSITO: Permitir estruturas parent/child multi-UID documentadas
#
# CASO DE USO: pgBackRest (Alpine, UID 70) cria subdiretório logs/ dentro
#              do diretório de backups PostgreSQL (também UID 70 após migração).
#              Ref: docker-compose.infra.yml linhas 241-242.
#
# FORMATO: ["path"]="uid:gid"
#
# NOTA (08/01/2026): Após migração para Alpine (UID 70), PostgreSQL e pgBackRest
#                    usam o mesmo UID, reduzindo necessidade de exceções.
#
# BENEFÍCIOS:
#   - Validação continua robusta para casos não documentados
#   - Sistema extensível para futuras exceções
#   - Logs claros para debugging (CLAUDE.md Regra 5)
#
# REF: CLAUDE.md Regra 6 (Enterprise-grade), Regra 11 (Best practices 2025)
# =============================================================================
declare -A VALIDATION_EXCEPTIONS=(
    # pgBackRest cria subdiretório logs/ com UID 70 (Alpine) dentro de postgresql/ (também UID 70)
    # Ref: docker-compose.infra.yml linhas 241-242 + pgBackRest docs
    ["/opt/alice/backups/postgresql/logs"]="70:70"
    
    # Adicionar futuras exceções aqui conforme necessário
    # Exemplo: ["/opt/alice/data/postgres/pg_wal"]="70:70"
)

# =============================================================================
# EXPORTAR PARA USO EM OUTROS SCRIPTS
# =============================================================================
# Scripts que fazem source deste arquivo podem usar:
#   - PERMISSIONS_CONFIG: Array com configurações de permissões
#   - VALIDATION_EXCEPTIONS: Array associativo de exceções
#   - ALICE_*_DIR: Constantes de diretórios base
#   - *_UID/*_GID: Constantes de UIDs/GIDs por serviço
# =============================================================================

# Nota: Em bash, arrays são exportados automaticamente quando o script
# é sourced. Não é necessário usar 'export' explicitamente.

# =============================================================================
# FIM DO ARQUIVO
# =============================================================================
