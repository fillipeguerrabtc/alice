#!/bin/bash
# =============================================================================
# Diagnóstico Completo de Falha de Deploy - Alice Platform
# =============================================================================
# Coleta logs, status e métricas de todos os containers para diagnóstico
#
# Autor: Fillipe Guerra
# Data: 29 de Dezembro de 2025
# =============================================================================

set -euo pipefail

echo "=============================================="
echo "DIAGNÓSTICO COMPLETO DE FALHA DE DEPLOY"
echo "=============================================="
echo ""

# Criar diretório de diagnóstico
DIAG_DIR="/tmp/alice-deploy-diag-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIAG_DIR"

echo "📁 Salvando diagnóstico em: $DIAG_DIR"
echo ""

# 1. Status de todos os containers
echo "1️⃣ Coletando status de containers..."
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.State}}" > "$DIAG_DIR/containers-status.txt" 2>&1 || true
docker compose -f /opt/alice/app/infra/docker/docker-compose.prod.yml ps > "$DIAG_DIR/compose-ps.txt" 2>&1 || true

# 2. Logs de containers críticos (últimas 500 linhas)
echo "2️⃣ Coletando logs de containers críticos..."
for container in alice-postgres alice-redis alice-qdrant alice-auth alice-chat alice-rag alice-training alice-gpu-manager alice-frontend; do
  if docker ps -a --filter "name=$container" --format "{{.Names}}" | grep -q "$container"; then
    echo "   - $container"
    docker logs --tail=500 "$container" > "$DIAG_DIR/logs-${container}.txt" 2>&1 || true
  fi
done

# 3. Healthcheck status
echo "3️⃣ Coletando healthcheck status..."
for container in $(docker ps -a --format "{{.Names}}"); do
  HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "no-healthcheck")
  echo "$container: $HEALTH" >> "$DIAG_DIR/healthcheck-status.txt"
  
  if [ "$HEALTH" = "unhealthy" ]; then
    docker inspect --format='{{range .State.Health.Log}}{{.Output}}{{end}}' "$container" > "$DIAG_DIR/healthcheck-${container}.txt" 2>&1 || true
  fi
done

# 4. Resource usage
echo "4️⃣ Coletando resource usage..."
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" > "$DIAG_DIR/resource-usage.txt" 2>&1 || true

# 5. Network connectivity
echo "5️⃣ Testando network connectivity..."
{
  echo "=== PostgreSQL Connectivity ==="
  docker exec alice-postgres pg_isready -U alice || echo "FALHA"
  echo ""
  
  echo "=== Redis Connectivity ==="
  # Tentar obter senha do .env.prod se disponível
  REDIS_PASSWORD="${REDIS_PASSWORD:-}"
  if [ -z "$REDIS_PASSWORD" ] && [ -f /opt/alice/app/infra/docker/.env.prod ]; then
    REDIS_PASSWORD=$(grep '^REDIS_PASSWORD=' /opt/alice/app/infra/docker/.env.prod | cut -d'=' -f2- || echo "")
  fi
  if [ -n "$REDIS_PASSWORD" ]; then
    docker exec alice-redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping || echo "FALHA"
  else
    docker exec alice-redis redis-cli ping || echo "FALHA"
  fi
  echo ""
  
  echo "=== Qdrant Connectivity ==="
  docker exec alice-qdrant wget -q --spider http://localhost:6333/healthz && echo "OK" || echo "FALHA"
  echo ""
} > "$DIAG_DIR/network-connectivity.txt" 2>&1 || true

# 6. Database state
echo "6️⃣ Coletando estado do database..."
{
  echo "=== Tables in public schema ==="
  docker exec alice-postgres psql -U alice -d alice_prod -c "\dt public.*" || echo "FALHA"
  echo ""
  
  echo "=== Database size ==="
  docker exec alice-postgres psql -U alice -d alice_prod -c "SELECT pg_size_pretty(pg_database_size('alice_prod'));" || echo "FALHA"
  echo ""
} > "$DIAG_DIR/database-state.txt" 2>&1 || true

# 7. Docker Compose config
echo "7️⃣ Coletando configuração..."
cp /opt/alice/app/infra/docker/docker-compose.prod.yml "$DIAG_DIR/" 2>&1 || true
if [ -f /opt/alice/app/infra/docker/.env.prod ]; then
  cp /opt/alice/app/infra/docker/.env.prod "$DIAG_DIR/env-prod.REDACTED.txt" 2>&1 || true
  # Remover senhas do arquivo copiado
  sed -i 's/\(PASSWORD\|SECRET\|KEY\|TOKEN\)=.*/\1=***REDACTED***/g' "$DIAG_DIR/env-prod.REDACTED.txt" 2>&1 || true
fi

# 8. System info
echo "8️⃣ Coletando system info..."
{
  echo "=== Hostname ==="
  hostname
  echo ""
  
  echo "=== Disk Usage ==="
  df -h /opt/alice || true
  echo ""
  
  echo "=== Memory ==="
  free -h || true
  echo ""
  
  echo "=== GPU ==="
  nvidia-smi || echo "GPU info não disponível"
  echo ""
} > "$DIAG_DIR/system-info.txt" 2>&1 || true

# 9. Compactar diagnóstico
echo "9️⃣ Compactando diagnóstico..."
cd /tmp
tar -czf "${DIAG_DIR}.tar.gz" "$(basename "$DIAG_DIR")" 2>&1 || true

echo ""
echo "✅ Diagnóstico completo salvo em: ${DIAG_DIR}.tar.gz"
echo "   Tamanho: $(du -h "${DIAG_DIR}.tar.gz" 2>/dev/null | cut -f1 || echo "N/A")"
echo ""
echo "📤 Para baixar o diagnóstico:"
echo "   scp root@\$HETZNER_VM_HOST:${DIAG_DIR}.tar.gz ."
echo ""
