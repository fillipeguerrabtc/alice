#!/usr/bin/env bash
# =============================================================================
# Verification Script: PR #13 Caddy Healthcheck Fixes
# =============================================================================
# Autor: Fillipe Guerra
# Data: 03/01/2026
#
# Este script verifica se TODAS as correções críticas do PR #13 estão
# corretamente aplicadas no repositório.
#
# Referência: https://github.com/fillipeguerrabtc/alice/pull/13
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}Verificação PR #13: Caddy Healthcheck Fixes${NC}"
echo -e "${BLUE}=============================================${NC}"
echo ""

FAILURES=0

# =============================================================================
# FIX 1: docker-compose.prod.yml - Healthcheck Duplo
# =============================================================================
echo -e "${BLUE}[FIX 1]${NC} Verificando docker-compose.prod.yml..."

COMPOSE_FILE="$REPO_ROOT/infra/docker/docker-compose.prod.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo -e "${RED}❌ ERRO: Arquivo não encontrado: $COMPOSE_FILE${NC}"
  FAILURES=$((FAILURES + 1))
else
  # Verificar timeout
  TIMEOUT=$(grep -A 25 "# CORREÇÃO 03/01/2026: Caddy 2.8" "$COMPOSE_FILE" | grep "timeout:" | head -1 | awk '{print $2}')
  if [ "$TIMEOUT" = "10s" ]; then
    echo -e "${GREEN}  ✅ timeout: 10s (correto)${NC}"
  else
    echo -e "${RED}  ❌ timeout: $TIMEOUT (deveria ser 10s)${NC}"
    FAILURES=$((FAILURES + 1))
  fi

  # Verificar retries
  RETRIES=$(grep -A 25 "# CORREÇÃO 03/01/2026: Caddy 2.8" "$COMPOSE_FILE" | grep "retries:" | head -1 | awk '{print $2}')
  if [ "$RETRIES" = "10" ]; then
    echo -e "${GREEN}  ✅ retries: 10 (correto)${NC}"
  else
    echo -e "${RED}  ❌ retries: $RETRIES (deveria ser 10)${NC}"
    FAILURES=$((FAILURES + 1))
  fi

  # Verificar start_period
  START_PERIOD=$(grep -A 25 "# CORREÇÃO 03/01/2026: Caddy 2.8" "$COMPOSE_FILE" | grep "start_period:" | head -1 | awk '{print $2}')
  if [ "$START_PERIOD" = "180s" ]; then
    echo -e "${GREEN}  ✅ start_period: 180s (correto)${NC}"
  else
    echo -e "${RED}  ❌ start_period: $START_PERIOD (deveria ser 180s)${NC}"
    FAILURES=$((FAILURES + 1))
  fi

  # Verificar teste duplo (Admin API + HTTP 80)
  if grep -q "wget --spider -q http://localhost:2019/config/ && wget --spider -q -O /dev/null http://localhost:80" "$COMPOSE_FILE"; then
    echo -e "${GREEN}  ✅ Healthcheck duplo (Admin API + HTTP 80)${NC}"
  else
    echo -e "${RED}  ❌ Healthcheck duplo não encontrado${NC}"
    FAILURES=$((FAILURES + 1))
  fi
fi

echo ""

# =============================================================================
# FIX 2: deploy-production.yml - Validação Imediata
# =============================================================================
echo -e "${BLUE}[FIX 2]${NC} Verificando deploy-production.yml..."

DEPLOY_FILE="$REPO_ROOT/.github/workflows/deploy-production.yml"

if [ ! -f "$DEPLOY_FILE" ]; then
  echo -e "${RED}❌ ERRO: Arquivo não encontrado: $DEPLOY_FILE${NC}"
  FAILURES=$((FAILURES + 1))
else
  # Verificar se tem validação após docker compose up
  if grep -q "CORREÇÃO 03/01/2026: Validar Caddy IMEDIATAMENTE após docker compose up" "$DEPLOY_FILE"; then
    echo -e "${GREEN}  ✅ Validação imediata presente${NC}"
  else
    echo -e "${RED}  ❌ Validação imediata não encontrada${NC}"
    FAILURES=$((FAILURES + 1))
  fi

  # Verificar sleep 30
  if grep -q "sleep 30" "$DEPLOY_FILE" | head -1; then
    echo -e "${GREEN}  ✅ Sleep 30s presente${NC}"
  else
    echo -e "${RED}  ❌ Sleep 30s não encontrado${NC}"
    FAILURES=$((FAILURES + 1))
  fi

  # Verificar docker inspect
  if grep -q "docker inspect --format='{{.State.Status}}' alice-caddy" "$DEPLOY_FILE"; then
    echo -e "${GREEN}  ✅ Docker inspect presente${NC}"
  else
    echo -e "${RED}  ❌ Docker inspect não encontrado${NC}"
    FAILURES=$((FAILURES + 1))
  fi

  # Verificar captura de logs
  if grep -q "docker logs alice-caddy" "$DEPLOY_FILE"; then
    echo -e "${GREEN}  ✅ Captura de logs presente${NC}"
  else
    echo -e "${RED}  ❌ Captura de logs não encontrada${NC}"
    FAILURES=$((FAILURES + 1))
  fi
fi

echo ""

# =============================================================================
# FIX 3: Caddyfile - Email Fallback
# =============================================================================
echo -e "${BLUE}[FIX 3]${NC} Verificando Caddyfile..."

CADDYFILE="$REPO_ROOT/infra/docker/Caddyfile"

if [ ! -f "$CADDYFILE" ]; then
  echo -e "${RED}❌ ERRO: Arquivo não encontrado: $CADDYFILE${NC}"
  FAILURES=$((FAILURES + 1))
else
  # Verificar sintaxe de fallback
  if grep -q 'email {\$ACME_EMAIL:noreply@yesyoudeserve.duckdns.org}' "$CADDYFILE"; then
    echo -e "${GREEN}  ✅ Email fallback correto${NC}"
  else
    echo -e "${RED}  ❌ Email fallback incorreto ou ausente${NC}"
    FAILURES=$((FAILURES + 1))
  fi
fi

echo ""

# =============================================================================
# RESULTADO FINAL
# =============================================================================
echo -e "${BLUE}=============================================${NC}"
if [ $FAILURES -eq 0 ]; then
  echo -e "${GREEN}✅ SUCESSO: Todas as verificações passaram!${NC}"
  echo -e "${GREEN}   PR #13 está corretamente aplicado.${NC}"
  exit 0
else
  echo -e "${RED}❌ FALHA: $FAILURES verificação(ões) falharam${NC}"
  echo -e "${RED}   PR #13 NÃO está corretamente aplicado.${NC}"
  exit 1
fi
