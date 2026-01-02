#!/bin/bash
# =============================================================================
# Script de Validação Pós-Deploy - Alice Enterprise Platform
# =============================================================================
# Descrição: Verifica se todos os serviços estão funcionando após o deploy
# Executa health checks em todos os endpoints críticos
# Produção: Hetzner Cloud (yesyoudeserve.duckdns.org)
#
# Uso: ./validate-deploy.sh [--verbose] [--domain DOMINIO]
#
# Documentação PT-BR (Regra 10 CLAUDE.md)
#
# Autor: Fillipe Guerra
# Data: 02 de Janeiro de 2026
# =============================================================================

set -e

# Configurações padrão
DOMAIN="${DOMAIN:-yesyoudeserve.duckdns.org}"
VERBOSE=false
TIMEOUT=10
MAX_RETRIES=3

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Contadores
PASSED=0
FAILED=0
WARNINGS=0

# Parse argumentos
while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --domain|-d)
            DOMAIN="$2"
            shift 2
            ;;
        *)
            echo "Uso: $0 [--verbose] [--domain DOMINIO]"
            exit 1
            ;;
    esac
done

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓ OK]${NC} $1"
    ((PASSED++))
}

log_fail() {
    echo -e "${RED}[✗ FAIL]${NC} $1"
    ((FAILED++))
}

log_warn() {
    echo -e "${YELLOW}[⚠ WARN]${NC} $1"
    ((WARNINGS++))
}

# Função para verificar endpoint HTTP
check_endpoint() {
    local name="$1"
    local url="$2"
    local expected_code="${3:-200}"
    local retry=0
    
    while [ $retry -lt $MAX_RETRIES ]; do
        response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout $TIMEOUT "$url" 2>/dev/null || echo "000")
        
        if [ "$response" == "$expected_code" ]; then
            log_success "$name ($url) - HTTP $response"
            return 0
        fi
        
        ((retry++))
        [ $retry -lt $MAX_RETRIES ] && sleep 2
    done
    
    log_fail "$name ($url) - HTTP $response (esperado: $expected_code)"
    return 1
}

# Função para verificar container Docker
check_container() {
    local name="$1"
    local container="$2"
    
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "running")
        if [ "$status" == "healthy" ] || [ "$status" == "running" ]; then
            log_success "Container $name ($container) - $status"
            return 0
        else
            log_warn "Container $name ($container) - $status"
            return 1
        fi
    else
        log_fail "Container $name ($container) - não encontrado"
        return 1
    fi
}

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     ALICE ENTERPRISE PLATFORM - VALIDAÇÃO PÓS-DEPLOY          ║${NC}"
echo -e "${BLUE}╠════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║  Domínio: ${GREEN}$DOMAIN${BLUE}                              ║${NC}"
echo -e "${BLUE}║  Data: $(date '+%Y-%m-%d %H:%M:%S')                                 ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# =============================================================================
# 1. VERIFICAR CONTAINERS DOCKER
# =============================================================================
echo -e "\n${YELLOW}═══ 1. CONTAINERS DOCKER ═══${NC}\n"

check_container "Caddy (API Gateway)" "alice-caddy"
check_container "PostgreSQL" "alice-postgres"
check_container "Auth Service" "alice-auth"
check_container "Chat Service" "alice-chat"
check_container "RAG Service" "alice-rag"
check_container "Training Service" "alice-training"
check_container "Integrations Service" "alice-integrations"
check_container "Frontend" "alice-frontend"
check_container "Observability" "alice-observability"
check_container "Vector (Logs)" "alice-vector"

# ERPNext containers
check_container "ERPNext Frontend" "erpnext-frontend"
check_container "ERPNext Backend" "erpnext-backend"
check_container "ERPNext MariaDB" "erpnext-mariadb"
check_container "ERPNext Redis Cache" "erpnext-redis-cache"

# =============================================================================
# 2. VERIFICAR ENDPOINTS HTTPS (EXTERNOS)
# =============================================================================
echo -e "\n${YELLOW}═══ 2. ENDPOINTS HTTPS ═══${NC}\n"

# Alice Frontend
check_endpoint "Frontend (Landing)" "https://$DOMAIN/"
check_endpoint "Frontend (Login)" "https://$DOMAIN/login"
check_endpoint "Frontend (Dashboard)" "https://$DOMAIN/dashboard"

# API Health Checks
check_endpoint "API Gateway Health" "https://$DOMAIN/api/health"
check_endpoint "Auth Service Health" "https://$DOMAIN/api/auth/health"
check_endpoint "Chat Service Health" "https://$DOMAIN/api/chat/health"
check_endpoint "RAG Service Health" "https://$DOMAIN/api/rag/health"
check_endpoint "Training Service Health" "https://$DOMAIN/api/training/health"
check_endpoint "Integrations Health" "https://$DOMAIN/api/integrations/health"

# ERPNext
check_endpoint "ERPNext" "https://erp.$DOMAIN/"

# Observability
check_endpoint "Grafana" "https://observability.$DOMAIN/"
check_endpoint "Prometheus" "https://metrics.$DOMAIN/-/healthy"
check_endpoint "Jaeger" "https://traces.$DOMAIN/"
check_endpoint "Langfuse" "https://langfuse.$DOMAIN/"

# =============================================================================
# 3. VERIFICAR CONEXÕES DE BANCO DE DADOS
# =============================================================================
echo -e "\n${YELLOW}═══ 3. CONEXÕES DE BANCO ═══${NC}\n"

# PostgreSQL
if docker exec alice-postgres pg_isready -U alice -d alice_db > /dev/null 2>&1; then
    log_success "PostgreSQL - conexão OK"
else
    log_fail "PostgreSQL - conexão falhou"
fi

# MariaDB (ERPNext)
if docker exec erpnext-mariadb mysqladmin ping -u root --silent > /dev/null 2>&1; then
    log_success "MariaDB (ERPNext) - conexão OK"
else
    log_warn "MariaDB (ERPNext) - não disponível"
fi

# Redis
if docker exec erpnext-redis-cache redis-cli ping > /dev/null 2>&1; then
    log_success "Redis Cache - conexão OK"
else
    log_warn "Redis Cache - não disponível"
fi

# =============================================================================
# 4. VERIFICAR SSL/TLS
# =============================================================================
echo -e "\n${YELLOW}═══ 4. CERTIFICADOS SSL ═══${NC}\n"

# Verificar certificado SSL
ssl_expiry=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$ssl_expiry" ]; then
    log_success "SSL válido até: $ssl_expiry"
else
    log_fail "SSL - não foi possível verificar certificado"
fi

# =============================================================================
# 5. VERIFICAR SERVIÇOS EXTERNOS
# =============================================================================
echo -e "\n${YELLOW}═══ 5. SERVIÇOS EXTERNOS ═══${NC}\n"

# GPU Manager Service (Hetzner GEX44)
# BUG FIX 25/12/2025: Porta corrigida de 3008 para 3010 (porta real do serviço)
# Verifica se container está rodando e healthy (melhor que tentar conectar via localhost)
if docker ps --filter "name=alice-gpu-manager" --filter "status=running" --format "{{.Names}}" | grep -q "alice-gpu-manager"; then
    log_success "GPU Manager Service - container rodando"
else
    log_warn "GPU Manager Service - container não está rodando (verificar se está iniciado)"
fi

# Stripe
if curl -s --connect-timeout 5 "https://api.stripe.com/v1/" > /dev/null 2>&1; then
    log_success "Stripe API - acessível"
else
    log_warn "Stripe API - não acessível"
fi

# =============================================================================
# RESUMO FINAL
# =============================================================================
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    RESUMO DA VALIDAÇÃO                         ║${NC}"
echo -e "${BLUE}╠════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║  ${GREEN}Passou:${NC}    $PASSED                                               ${BLUE}║${NC}"
echo -e "${BLUE}║  ${RED}Falhou:${NC}    $FAILED                                               ${BLUE}║${NC}"
echo -e "${BLUE}║  ${YELLOW}Avisos:${NC}    $WARNINGS                                               ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ Deploy validado com sucesso!${NC}"
    exit 0
elif [ $FAILED -le 3 ]; then
    echo -e "${YELLOW}⚠ Deploy parcialmente validado - verificar falhas${NC}"
    exit 1
else
    echo -e "${RED}✗ Deploy com problemas críticos - investigar imediatamente${NC}"
    exit 2
fi
