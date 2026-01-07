#!/bin/bash
# =============================================================================
# Alice Enterprise Platform - Production Server Preparation Script
# =============================================================================
# Autor: Fillipe Guerra
# Data: 07 de Janeiro de 2026
# Versão: 1.0.0
#
# PROPÓSITO:
#   Script idempotente para preparar servidor de produção Hetzner GEX44
#   com todas as dependências, estruturas de diretórios e permissões
#   necessárias para deploy dos 50 containers Alice.
#
# VALIDAÇÕES:
#   - Servidor correto (178.63.41.108)
#   - GPU disponível (NVIDIA)
#   - Docker + NVIDIA Container Toolkit
#
# ESTRUTURA CRIADA:
#   - /opt/alice (30+ diretórios)
#   - Networks Docker externas
#   - Permissões específicas por serviço (999, 472, 65534, etc)
#
# EXECUÇÃO:
#   sudo ./prepare-production-server.sh
#
# IDEMPOTÊNCIA:
#   - Pode ser executado múltiplas vezes sem problemas
#   - Verifica antes de criar (mkdir -p, network create || true)
#   - Não sobrescreve dados existentes
#
# REFERÊNCIAS:
#   - CLAUDE.md Regra 6: Enterprise-grade, sem workarounds
#   - CLAUDE.md Regra 16: Fail-fast, validações robustas
# =============================================================================

set -euo pipefail

# =============================================================================
# VALIDAÇÕES PRÉ-REQUISITOS
# =============================================================================

echo ""
echo "🔍 VALIDAÇÕES PRÉ-REQUISITOS"
echo "============================================="

# -----------------------------------------------------------------------------
# 1. Validar servidor correto (178.63.41.108)
# -----------------------------------------------------------------------------
echo "📍 Validando servidor de produção..."

if ! hostname -I | grep -qw "178.63.41.108"; then
  echo "❌ ERRO: Este NÃO é o servidor de produção!"
  echo ""
  echo "   IPs encontrados: $(hostname -I)"
  echo "   IP esperado: 178.63.41.108"
  echo ""
  echo "Este script DEVE ser executado no Production Server (Hetzner GEX44)."
  exit 1
fi

echo "   ✅ Servidor de produção correto (178.63.41.108)"

# -----------------------------------------------------------------------------
# 2. Validar GPU disponível
# -----------------------------------------------------------------------------
echo "🎮 Validando GPU NVIDIA..."

if ! command -v nvidia-smi &> /dev/null; then
  echo "❌ ERRO: nvidia-smi não encontrado!"
  echo ""
  echo "Este servidor precisa de GPU para rodar os containers de inferência."
  echo ""
  echo "Instalação necessária:"
  echo "  1. NVIDIA Driver"
  echo "  2. NVIDIA Container Toolkit"
  exit 1
fi

echo "   ✅ nvidia-smi encontrado"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

# -----------------------------------------------------------------------------
# 3. Validar Docker
# -----------------------------------------------------------------------------
echo "🐳 Validando Docker..."

if ! command -v docker &> /dev/null; then
  echo "❌ ERRO: Docker não encontrado!"
  echo ""
  echo "Instalação necessária:"
  echo "  1. Docker Engine"
  echo "  2. Docker Compose"
  exit 1
fi

DOCKER_VERSION=$(docker --version)
echo "   ✅ Docker encontrado: $DOCKER_VERSION"

# -----------------------------------------------------------------------------
# 4. Validar Docker com GPU
# -----------------------------------------------------------------------------
echo "🧪 Validando Docker com GPU..."

if ! docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi &> /dev/null; then
  echo "❌ ERRO: Docker não consegue acessar GPU!"
  echo ""
  echo "Verifique configuração NVIDIA Container Toolkit:"
  echo "  - /etc/docker/daemon.json deve conter 'nvidia' como runtime padrão"
  echo "  - sudo systemctl restart docker após mudanças"
  exit 1
fi

echo "   ✅ Docker com GPU funcionando"
echo ""

# =============================================================================
# CRIAÇÃO DE ESTRUTURA DE DIRETÓRIOS
# =============================================================================

echo "📁 CRIANDO ESTRUTURA DE DIRETÓRIOS"
echo "============================================="

# -----------------------------------------------------------------------------
# Diretórios raiz
# -----------------------------------------------------------------------------
echo "📝 Criando diretórios raiz..."
mkdir -p /opt/alice/{data,logs,uploads,backups,secrets,versions,app}
echo "   ✅ Diretórios raiz criados"

# -----------------------------------------------------------------------------
# Diretórios de dados (volumes) - INFRA Stack
# -----------------------------------------------------------------------------
echo "📝 Criando diretórios INFRA stack..."
mkdir -p /opt/alice/data/postgres
mkdir -p /opt/alice/data/redis-alice
mkdir -p /opt/alice/data/qdrant
mkdir -p /opt/alice/data/minio
mkdir -p /opt/alice/data/caddy
mkdir -p /opt/alice/data/caddy-config
mkdir -p /opt/alice/data/searxng-config
mkdir -p /opt/alice/data/pgbackrest-spool
echo "   ✅ Diretórios INFRA stack criados"

# -----------------------------------------------------------------------------
# Diretórios de dados (volumes) - OBSERVABILITY Stack
# -----------------------------------------------------------------------------
echo "📝 Criando diretórios OBSERVABILITY stack..."
mkdir -p /opt/alice/data/vector
mkdir -p /opt/alice/data/langfuse-db
mkdir -p /opt/alice/data/clickhouse
mkdir -p /opt/alice/data/prometheus
mkdir -p /opt/alice/data/grafana
mkdir -p /opt/alice/data/loki
mkdir -p /opt/alice/data/jaeger
echo "   ✅ Diretórios OBSERVABILITY stack criados"

# -----------------------------------------------------------------------------
# Diretórios de dados (volumes) - ERPNEXT Stack
# -----------------------------------------------------------------------------
echo "📝 Criando diretórios ERPNEXT stack..."
mkdir -p /opt/alice/data/erpnext-sites
mkdir -p /opt/alice/data/erpnext-mariadb
mkdir -p /opt/alice/data/erpnext-redis-cache
mkdir -p /opt/alice/data/erpnext-redis-queue
echo "   ✅ Diretórios ERPNEXT stack criados"

# -----------------------------------------------------------------------------
# Diretórios de logs
# -----------------------------------------------------------------------------
echo "📝 Criando diretórios de logs..."
mkdir -p /opt/alice/logs/caddy
mkdir -p /opt/alice/logs/erpnext
mkdir -p /opt/alice/logs/clickhouse
mkdir -p /opt/alice/logs/jaeger
echo "   ✅ Diretórios de logs criados"

# -----------------------------------------------------------------------------
# Diretórios de uploads e backups
# -----------------------------------------------------------------------------
echo "📝 Criando diretórios de uploads e backups..."
mkdir -p /opt/alice/uploads/training
mkdir -p /opt/alice/backups/postgresql
mkdir -p /opt/alice/backups/postgresql/logs
mkdir -p /opt/alice/backups/manifests
echo "   ✅ Diretórios de uploads e backups criados"

# -----------------------------------------------------------------------------
# Diretórios de secrets e versões
# -----------------------------------------------------------------------------
echo "📝 Criando diretórios de secrets e versões..."
mkdir -p /opt/alice/secrets
mkdir -p /opt/alice/versions
echo "   ✅ Diretórios de secrets e versões criados"
echo ""

# =============================================================================
# CONFIGURAÇÃO DE PERMISSÕES POR SERVIÇO
# =============================================================================

echo "🔐 CONFIGURANDO PERMISSÕES POR SERVIÇO"
echo "============================================="

# PostgreSQL (UID 999)
echo "📝 PostgreSQL (UID 999)..."
sudo chown -R 999:999 /opt/alice/data/postgres
sudo chmod 700 /opt/alice/data/postgres
echo "   ✅ PostgreSQL configurado"

# Grafana (UID 472)
echo "📝 Grafana (UID 472)..."
sudo chown -R 472:472 /opt/alice/data/grafana
sudo chmod 755 /opt/alice/data/grafana
echo "   ✅ Grafana configurado"

# Prometheus (UID 65534 - nobody)
echo "📝 Prometheus (UID 65534)..."
sudo chown -R 65534:65534 /opt/alice/data/prometheus
sudo chmod 755 /opt/alice/data/prometheus
echo "   ✅ Prometheus configurado"

# Loki (UID 10001)
echo "📝 Loki (UID 10001)..."
sudo chown -R 10001:10001 /opt/alice/data/loki
sudo chmod 755 /opt/alice/data/loki
echo "   ✅ Loki configurado"

# ClickHouse (UID 101)
echo "📝 ClickHouse (UID 101)..."
sudo chown -R 101:101 /opt/alice/data/clickhouse /opt/alice/logs/clickhouse
sudo chmod 755 /opt/alice/data/clickhouse /opt/alice/logs/clickhouse
echo "   ✅ ClickHouse configurado"

# Langfuse DB PostgreSQL (UID 70)
echo "📝 Langfuse DB (UID 70)..."
sudo chown -R 70:70 /opt/alice/data/langfuse-db
sudo chmod 755 /opt/alice/data/langfuse-db
echo "   ✅ Langfuse DB configurado"

# Redis (UID 999)
echo "📝 Redis (UID 999)..."
sudo chown -R 999:999 /opt/alice/data/redis-alice
sudo chmod 755 /opt/alice/data/redis-alice
echo "   ✅ Redis configurado"

# Caddy (UID 1000)
echo "📝 Caddy (UID 1000)..."
sudo chown -R 1000:1000 /opt/alice/data/caddy /opt/alice/data/caddy-config /opt/alice/logs/caddy
sudo chmod 700 /opt/alice/data/caddy
sudo chmod 755 /opt/alice/data/caddy-config /opt/alice/logs/caddy
echo "   ✅ Caddy configurado"

# SearXNG (UID 977)
echo "📝 SearXNG (UID 977)..."
sudo chown -R 977:977 /opt/alice/data/searxng-config
sudo chmod 755 /opt/alice/data/searxng-config
echo "   ✅ SearXNG configurado"

# Qdrant, MinIO, Vector (root - permissões gerais)
echo "📝 Qdrant, MinIO, Vector..."
sudo chmod 755 /opt/alice/data/qdrant /opt/alice/data/minio /opt/alice/data/vector
echo "   ✅ Qdrant, MinIO, Vector configurados"

# ERPNext (UID 1000 para Frappe)
echo "📝 ERPNext (UID 1000)..."
sudo chown -R 1000:1000 /opt/alice/data/erpnext-sites /opt/alice/logs/erpnext
sudo chmod 755 /opt/alice/data/erpnext-sites /opt/alice/logs/erpnext
echo "   ✅ ERPNext configurado"

# Backups (root com permissões restritas)
echo "📝 Backups..."
sudo chmod 750 /opt/alice/backups
sudo chmod 750 /opt/alice/backups/postgresql
echo "   ✅ Backups configurado"

# Uploads (para RAG multimodal)
echo "📝 Uploads..."
sudo chmod 755 /opt/alice/uploads
echo "   ✅ Uploads configurado"
echo ""

# =============================================================================
# CRIAÇÃO DE NETWORKS DOCKER EXTERNAS
# =============================================================================

echo "🌐 CRIANDO NETWORKS DOCKER EXTERNAS"
echo "============================================="

# alice-network (subnet específica 172.28.0.0/16)
if ! docker network inspect alice-network > /dev/null 2>&1; then
  echo "📝 Criando network alice-network..."
  docker network create --driver bridge --subnet 172.28.0.0/16 alice-network
  echo "   ✅ alice-network criada"
else
  echo "   ✅ alice-network já existe"
fi

# erpnext-network
if ! docker network inspect erpnext-network > /dev/null 2>&1; then
  echo "📝 Criando network erpnext-network..."
  docker network create --driver bridge erpnext-network
  echo "   ✅ erpnext-network criada"
else
  echo "   ✅ erpnext-network já existe"
fi

echo ""

# =============================================================================
# VALIDAÇÃO FINAL
# =============================================================================

echo "✅ VALIDAÇÃO FINAL"
echo "============================================="

# Validar permissões PostgreSQL (crítico)
echo "🧪 Validando permissões PostgreSQL..."
POSTGRES_DIR="/opt/alice/data/postgres"

# Verificar owner/group
ACTUAL_OWNER=$(stat -c '%u:%g' "$POSTGRES_DIR")
if [ "$ACTUAL_OWNER" != "999:999" ]; then
  echo "❌ ERRO: Owner incorreto em $POSTGRES_DIR"
  echo "   Esperado: 999:999"
  echo "   Atual: $ACTUAL_OWNER"
  exit 1
fi

# Verificar permissões
ACTUAL_PERMS=$(stat -c '%a' "$POSTGRES_DIR")
if [ "$ACTUAL_PERMS" != "700" ]; then
  echo "❌ ERRO: Permissões incorretas em $POSTGRES_DIR"
  echo "   Esperado: 700"
  echo "   Atual: $ACTUAL_PERMS"
  exit 1
fi

# Teste de escrita
if ! sudo -u "#999" touch "$POSTGRES_DIR/.write-test" 2>/dev/null; then
  echo "❌ ERRO: Usuário 999 (postgres) NÃO consegue escrever"
  exit 1
fi

sudo rm -f "$POSTGRES_DIR/.write-test"
echo "   ✅ Permissões PostgreSQL OK"

# Validar networks
echo "🧪 Validando networks Docker..."
if ! docker network inspect alice-network > /dev/null 2>&1; then
  echo "❌ ERRO: alice-network não existe!"
  exit 1
fi

if ! docker network inspect erpnext-network > /dev/null 2>&1; then
  echo "❌ ERRO: erpnext-network não existe!"
  exit 1
fi

echo "   ✅ Networks Docker OK"
echo ""

# =============================================================================
# SUCESSO
# =============================================================================

echo "🎉 SUCESSO!"
echo "============================================="
echo ""
echo "Servidor de produção preparado com sucesso!"
echo ""
echo "Próximos passos:"
echo "  1. Execute o workflow de deploy: deploy-stack-modular.yml"
echo "  2. O deploy criará automaticamente os containers"
echo "  3. Monitore os logs em /opt/alice/logs/"
echo ""
echo "Estrutura criada:"
echo "  - /opt/alice/ (30+ diretórios)"
echo "  - Networks Docker: alice-network, erpnext-network"
echo "  - Permissões configuradas para 13 serviços"
echo ""
echo "============================================="
