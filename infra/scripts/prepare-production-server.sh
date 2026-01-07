#!/bin/bash
# =============================================================================
# Script de Preparação Enterprise do Servidor de Produção
# =============================================================================
# IDEMPOTENTE: Pode rodar múltiplas vezes sem quebrar
# FAIL-FAST: Para no primeiro erro
# Autor: Fillipe Guerra
# Data: 07/01/2026
# Versão: 1.0.0
# =============================================================================
# PROPÓSITO:
# - Preparar servidor limpo para primeiro deploy da Alice Enterprise Platform
# - Criar estrutura /opt/alice com permissões corretas
# - Validar Docker, Docker Compose, GPU
# - Criar networks Docker externas
# - Script é idempotente (pode rodar múltiplas vezes)
# =============================================================================

set -euo pipefail

echo "🏗️ PREPARANDO SERVIDOR DE PRODUÇÃO"
echo "========================================"
echo ""

# =============================================================================
# 1. VALIDAR SERVIDOR CORRETO
# =============================================================================
echo "🔍 Validando servidor..."

# Verificar IP do servidor
SERVER_IP=$(hostname -I | awk '{print $1}')
echo "   IP do servidor: $SERVER_IP"

# Verificar se é o Production Server correto (178.63.41.108 - Hetzner GEX44)
if [ "$SERVER_IP" != "178.63.41.108" ]; then
  echo "❌ ERRO: Servidor errado!"
  echo "   IP atual: $SERVER_IP"
  echo "   IP esperado: 178.63.41.108 (Production Server Hetzner GEX44)"
  echo ""
  echo "Este script só deve rodar no Production Server."
  exit 1
fi

echo "✅ Servidor de produção correto (178.63.41.108)"

# =============================================================================
# 2. VALIDAR GPU
# =============================================================================
echo ""
echo "🎮 Validando GPU..."

if ! command -v nvidia-smi &> /dev/null; then
  echo "❌ ERRO: nvidia-smi não encontrado!"
  echo "   GPU não está disponível ou drivers NVIDIA não instalados."
  exit 1
fi

echo "✅ GPU disponível:"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

# Verificar runtime Docker com GPU
if ! docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi &> /dev/null; then
  echo "❌ ERRO: Docker não consegue acessar GPU!"
  echo "   Verifique NVIDIA Container Toolkit e configuração Docker."
  exit 1
fi

echo "✅ Docker com acesso à GPU"

# =============================================================================
# 3. VALIDAR DOCKER E DOCKER COMPOSE
# =============================================================================
echo ""
echo "🐳 Validando Docker..."

if ! command -v docker &> /dev/null; then
  echo "❌ ERRO: Docker não encontrado!"
  exit 1
fi

DOCKER_VERSION=$(docker version --format '{{.Server.Version}}')
echo "✅ Docker instalado: v$DOCKER_VERSION"

if ! docker compose version &> /dev/null; then
  echo "❌ ERRO: Docker Compose não encontrado!"
  exit 1
fi

COMPOSE_VERSION=$(docker compose version --short)
echo "✅ Docker Compose instalado: v$COMPOSE_VERSION"

# =============================================================================
# 4. CRIAR ESTRUTURA DE DIRETÓRIOS
# =============================================================================
echo ""
echo "📁 Criando estrutura de diretórios..."

# Diretório raiz
mkdir -p /opt/alice

# Diretórios principais
mkdir -p /opt/alice/{data,logs,uploads,backups,secrets,versions,app}

# Diretórios de dados (volumes) - INFRA stack
mkdir -p /opt/alice/data/{postgres,redis-alice,qdrant,minio,caddy,caddy-config}
mkdir -p /opt/alice/data/{searxng-config,pgbackrest-spool}

# Diretórios de dados (volumes) - OBSERVABILITY stack
mkdir -p /opt/alice/data/{vector,langfuse-db,clickhouse}
mkdir -p /opt/alice/data/{prometheus,grafana,loki,jaeger}

# Diretórios de dados (volumes) - ERPNEXT stack
mkdir -p /opt/alice/data/{erpnext-sites,erpnext-mariadb,erpnext-redis-cache,erpnext-redis-queue}

# Diretórios de logs
mkdir -p /opt/alice/logs/{caddy,erpnext,clickhouse,jaeger}

# Diretórios de uploads e backups
mkdir -p /opt/alice/uploads/training
mkdir -p /opt/alice/backups/{postgresql,postgresql/logs,manifests}

# Diretórios de secrets e versões
mkdir -p /opt/alice/secrets
mkdir -p /opt/alice/versions

echo "✅ Estrutura de diretórios criada"

# =============================================================================
# 5. CONFIGURAR PERMISSÕES
# =============================================================================
echo ""
echo "🔐 Configurando permissões..."

# PostgreSQL (UID 999) - CRÍTICO
if ! sudo chown -R 999:999 /opt/alice/data/postgres; then
  echo "❌ ERRO: Falha ao configurar owner do diretório PostgreSQL"
  ls -ld /opt/alice/data/postgres
  exit 1
fi
if ! chmod 700 /opt/alice/data/postgres; then
  echo "❌ ERRO: Falha ao configurar permissões do diretório PostgreSQL"
  ls -ld /opt/alice/data/postgres
  exit 1
fi
echo "   ✅ PostgreSQL (999:999, 700)"

# Grafana (UID 472)
sudo chown -R 472:472 /opt/alice/data/grafana
chmod 755 /opt/alice/data/grafana
echo "   ✅ Grafana (472:472, 755)"

# Prometheus (UID 65534 - nobody)
sudo chown -R 65534:65534 /opt/alice/data/prometheus
chmod 755 /opt/alice/data/prometheus
echo "   ✅ Prometheus (65534:65534, 755)"

# Loki (UID 10001)
sudo chown -R 10001:10001 /opt/alice/data/loki
chmod 755 /opt/alice/data/loki
echo "   ✅ Loki (10001:10001, 755)"

# ClickHouse (UID 101)
sudo chown -R 101:101 /opt/alice/data/clickhouse /opt/alice/logs/clickhouse
chmod 755 /opt/alice/data/clickhouse /opt/alice/logs/clickhouse
echo "   ✅ ClickHouse (101:101, 755)"

# Langfuse DB PostgreSQL (UID 70)
sudo chown -R 70:70 /opt/alice/data/langfuse-db
chmod 755 /opt/alice/data/langfuse-db
echo "   ✅ Langfuse DB (70:70, 755)"

# Redis (UID 999)
sudo chown -R 999:999 /opt/alice/data/redis-alice
chmod 755 /opt/alice/data/redis-alice
echo "   ✅ Redis (999:999, 755)"

# Caddy (UID 1000)
sudo chown -R 1000:1000 /opt/alice/data/caddy /opt/alice/data/caddy-config /opt/alice/logs/caddy
chmod 700 /opt/alice/data/caddy
chmod 755 /opt/alice/data/caddy-config /opt/alice/logs/caddy
echo "   ✅ Caddy (1000:1000, 700/755)"

# SearXNG (UID 977)
sudo chown -R 977:977 /opt/alice/data/searxng-config
chmod 755 /opt/alice/data/searxng-config
echo "   ✅ SearXNG (977:977, 755)"

# Qdrant, MinIO, Vector (permissões gerais)
chmod 755 /opt/alice/data/{qdrant,minio,vector}
echo "   ✅ Qdrant, MinIO, Vector (755)"

# ERPNext (UID 1000 para Frappe)
sudo chown -R 1000:1000 /opt/alice/data/erpnext-sites /opt/alice/logs/erpnext
chmod 755 /opt/alice/data/erpnext-sites /opt/alice/logs/erpnext
echo "   ✅ ERPNext (1000:1000, 755)"

# Backups (root com permissões restritas)
chmod 750 /opt/alice/backups
chmod 750 /opt/alice/backups/postgresql
echo "   ✅ Backups (750)"

# Uploads (para RAG multimodal)
chmod 755 /opt/alice/uploads
echo "   ✅ Uploads (755)"

# =============================================================================
# 6. VALIDAR PERMISSÕES POSTGRESQL
# =============================================================================
echo ""
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

# Verificar permissões (700 = rwx------)
ACTUAL_PERMS=$(stat -c '%a' "$POSTGRES_DIR")
if [ "$ACTUAL_PERMS" != "700" ]; then
  echo "❌ ERRO: Permissões incorretas em $POSTGRES_DIR"
  echo "   Esperado: 700"
  echo "   Atual: $ACTUAL_PERMS"
  exit 1
fi

# Teste de escrita como usuário 999
if ! sudo -u "#999" touch "$POSTGRES_DIR/.write-test" 2>/dev/null; then
  echo "❌ ERRO: Usuário 999 (postgres) NÃO consegue escrever"
  ls -ld "$POSTGRES_DIR"
  exit 1
fi

rm -f "$POSTGRES_DIR/.write-test"
echo "✅ Permissões PostgreSQL validadas (UID 999 pode escrever)"

# =============================================================================
# 7. CRIAR DOCKER NETWORKS EXTERNAS
# =============================================================================
echo ""
echo "🌐 Criando Docker networks..."

# Network principal Alice (com subnet específica)
if ! docker network inspect alice-network > /dev/null 2>&1; then
  docker network create --driver bridge --subnet 172.28.0.0/16 alice-network
  echo "   ✅ alice-network criada (172.28.0.0/16)"
else
  echo "   ℹ️  alice-network já existe"
fi

# Network ERPNext (isolada)
if ! docker network inspect erpnext-network > /dev/null 2>&1; then
  docker network create --driver bridge erpnext-network
  echo "   ✅ erpnext-network criada"
else
  echo "   ℹ️  erpnext-network já existe"
fi

# =============================================================================
# 8. RESUMO FINAL
# =============================================================================
echo ""
echo "========================================"
echo "✅ SERVIDOR PREPARADO COM SUCESSO!"
echo "========================================"
echo ""
echo "📋 Resumo:"
echo "   • Servidor validado: 178.63.41.108 (Hetzner GEX44)"
echo "   • GPU validada: $(nvidia-smi --query-gpu=name --format=csv,noheader)"
echo "   • Docker validado: v$DOCKER_VERSION"
echo "   • Docker Compose validado: v$COMPOSE_VERSION"
echo "   • Estrutura /opt/alice criada"
echo "   • Permissões configuradas (UID 999, 472, 65534, etc)"
echo "   • Permissões PostgreSQL validadas"
echo "   • Networks Docker criadas (alice-network, erpnext-network)"
echo ""
echo "🚀 Próximo passo:"
echo "   Execute o workflow de deploy via GitHub Actions"
echo "   gh workflow run deploy-stack-modular.yml -f stack=all -f version=v1.0.0"
echo ""
