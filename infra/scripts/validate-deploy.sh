#!/bin/bash
# =============================================================================
# Script de Validacao Pos-Deploy - Alice Enterprise Platform
# =============================================================================
# Descricao: Verifica se os servicos criticos estao saudaveis apos deploy,
# manutencao ou reboot do host, com foco explicito no serving GPU.
#
# Uso: ./validate-deploy.sh [--verbose] [--domain DOMINIO]
#
# Autor: Fillipe Guerra
# Data: 21 de Marco de 2026
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NVIDIA_RUNTIME_CHECK_SCRIPT="${SCRIPT_DIR}/check-nvidia-runtime.sh"

# Configuracoes padrao
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
    case "$1" in
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
    echo -e "${GREEN}[OK]${NC} $1"
    ((PASSED++))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAILED++))
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    ((WARNINGS++))
}

normalize_whitespace() {
    local value="${1:-}"
    printf '%s' "$value" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

# Funcao para verificar endpoint HTTP
check_endpoint() {
    local name="$1"
    local url="$2"
    local expected_code="${3:-200}"
    local retry=0
    local response="000"

    while [[ $retry -lt $MAX_RETRIES ]]; do
        response="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout "$TIMEOUT" "$url" 2>/dev/null || echo "000")"

        if [[ "$response" == "$expected_code" ]]; then
            log_success "$name ($url) - HTTP $response"
            return 0
        fi

        ((retry++))
        [[ $retry -lt $MAX_RETRIES ]] && sleep 2
    done

    log_fail "$name ($url) - HTTP $response (esperado: $expected_code)"
    return 1
}

# Funcao para verificar container Docker com diagnostico operacional
check_container() {
    local name="$1"
    local container="$2"
    local severity="${3:-critical}"
    local state=""
    local health=""
    local exit_code=""
    local restart_count=""
    local error_message=""
    local detail=""

    if ! docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
        if [[ "$severity" == "warning" ]]; then
            log_warn "Container $name ($container) - nao encontrado"
        else
            log_fail "Container $name ($container) - nao encontrado"
        fi
        return 1
    fi

    state="$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "unknown")"
    health="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo "unknown")"
    exit_code="$(docker inspect --format='{{.State.ExitCode}}' "$container" 2>/dev/null || echo "-1")"
    restart_count="$(docker inspect --format='{{.RestartCount}}' "$container" 2>/dev/null || echo "0")"
    error_message="$(normalize_whitespace "$(docker inspect --format='{{.State.Error}}' "$container" 2>/dev/null || true)")"

    if [[ "$state" == "running" && ( "$health" == "healthy" || "$health" == "none" ) ]]; then
        log_success "Container $name ($container) - state=$state health=$health restarts=$restart_count"
        return 0
    fi

    detail="Container $name ($container) - state=$state health=$health exit=$exit_code restarts=$restart_count"
    if [[ -n "$error_message" ]]; then
        detail="$detail error=$error_message"
    fi

    if [[ "$severity" == "warning" ]]; then
        log_warn "$detail"
    else
        log_fail "$detail"
    fi

    if [[ "$VERBOSE" == true ]]; then
        log_info "Ultimos logs de $container:"
        docker logs "$container" --tail 20 2>&1 || true
    fi

    return 1
}

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     ALICE ENTERPRISE PLATFORM - VALIDACAO POS-DEPLOY          ║${NC}"
echo -e "${BLUE}╠════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║  Dominio: ${GREEN}$DOMAIN${BLUE}                              ║${NC}"
echo -e "${BLUE}║  Data: $(date '+%Y-%m-%d %H:%M:%S')                                 ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# =============================================================================
# 1. VALIDAR RUNTIME NVIDIA E CDI
# =============================================================================
echo -e "\n${YELLOW}═══ 1. RUNTIME NVIDIA E CDI ═══${NC}\n"

if [[ -x "$NVIDIA_RUNTIME_CHECK_SCRIPT" ]]; then
    if "$NVIDIA_RUNTIME_CHECK_SCRIPT" --skip-docker-gpu-test; then
        log_success "Runtime NVIDIA/CDI alinhado ao driver do host"
    else
        log_fail "Runtime NVIDIA/CDI inconsistente; investigar antes de confiar nos logs dos containers GPU"
    fi
else
    log_warn "Script complementar ausente: $NVIDIA_RUNTIME_CHECK_SCRIPT"
fi

# =============================================================================
# 2. VERIFICAR CONTAINERS DOCKER
# =============================================================================
echo -e "\n${YELLOW}═══ 2. CONTAINERS DOCKER ═══${NC}\n"

check_container "Caddy (API Gateway)" "alice-caddy"
check_container "PostgreSQL" "alice-postgres"
check_container "Auth Service" "alice-auth"
check_container "Chat Service" "alice-chat"
check_container "RAG Service" "alice-rag"
check_container "Training Service" "alice-training"
check_container "Integrations Service" "alice-integrations"
check_container "Frontend" "alice-frontend"
check_container "Observability" "alice-observability"
check_container "Vector (Logs)" "alice-vector" "warning"
check_container "GPU Manager" "alice-gpu-manager"
check_container "GPU LLM" "gpu-llm"
check_container "GPU Embeddings" "gpu-embeddings"

# =============================================================================
# 3. VERIFICAR ENDPOINTS HTTPS (EXTERNOS)
# =============================================================================
echo -e "\n${YELLOW}═══ 3. ENDPOINTS HTTPS ═══${NC}\n"

check_endpoint "Frontend (Landing)" "https://$DOMAIN/"
check_endpoint "Frontend (Login)" "https://$DOMAIN/login"
check_endpoint "Frontend (Dashboard)" "https://$DOMAIN/dashboard"
check_endpoint "API Gateway Health" "https://$DOMAIN/api/health"
check_endpoint "Auth Service Health" "https://$DOMAIN/api/auth/health"
check_endpoint "Chat Service Health" "https://$DOMAIN/api/chat/health"
check_endpoint "RAG Service Health" "https://$DOMAIN/api/rag/health"
check_endpoint "Training Service Health" "https://$DOMAIN/api/training/health"
check_endpoint "Integrations Health" "https://$DOMAIN/api/integrations/health"
check_endpoint "Grafana" "https://observability.$DOMAIN/"
check_endpoint "Prometheus" "https://metrics.$DOMAIN/-/healthy"
check_endpoint "Jaeger" "https://traces.$DOMAIN/"
check_endpoint "Langfuse" "https://langfuse.$DOMAIN/"

# =============================================================================
# 4. VERIFICAR SERVING GPU REAL
# =============================================================================
echo -e "\n${YELLOW}═══ 4. SERVING GPU LOCAL ═══${NC}\n"

check_endpoint "GPU Manager Live (local)" "http://127.0.0.1:3010/live"
check_endpoint "GPU LLM Health (local)" "http://127.0.0.1:8004/health"
check_endpoint "GPU Embeddings Health (local)" "http://127.0.0.1:8001/health"

# =============================================================================
# 5. VERIFICAR CONEXOES DE BANCO DE DADOS
# =============================================================================
echo -e "\n${YELLOW}═══ 5. CONEXOES DE BANCO ═══${NC}\n"

if docker exec alice-postgres pg_isready -U alice -d alice_db >/dev/null 2>&1; then
    log_success "PostgreSQL - conexao OK"
else
    log_fail "PostgreSQL - conexao falhou"
fi

if docker exec alice-redis redis-cli ping >/dev/null 2>&1; then
    log_success "Redis (Alice) - conexao OK"
else
    log_warn "Redis (Alice) - nao disponivel"
fi

# =============================================================================
# 6. VERIFICAR SSL/TLS
# =============================================================================
echo -e "\n${YELLOW}═══ 6. CERTIFICADOS SSL ═══${NC}\n"

ssl_expiry="$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
if [[ -n "$ssl_expiry" ]]; then
    log_success "SSL valido ate: $ssl_expiry"
else
    log_fail "SSL - nao foi possivel verificar certificado"
fi

# =============================================================================
# 7. VERIFICAR SERVICOS EXTERNOS
# =============================================================================
echo -e "\n${YELLOW}═══ 7. SERVICOS EXTERNOS ═══${NC}\n"

if curl -sS --connect-timeout 5 "https://api.stripe.com/v1/" >/dev/null 2>&1; then
    log_success "Stripe API - acessivel"
else
    log_warn "Stripe API - nao acessivel"
fi

# =============================================================================
# RESUMO FINAL
# =============================================================================
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    RESUMO DA VALIDACAO                         ║${NC}"
echo -e "${BLUE}╠════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║  ${GREEN}Passou:${NC}    $PASSED                                               ${BLUE}║${NC}"
echo -e "${BLUE}║  ${RED}Falhou:${NC}    $FAILED                                               ${BLUE}║${NC}"
echo -e "${BLUE}║  ${YELLOW}Avisos:${NC}    $WARNINGS                                               ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}Deploy validado com sucesso!${NC}"
    exit 0
elif [[ $FAILED -le 3 ]]; then
    echo -e "${YELLOW}Deploy parcialmente validado - verificar falhas${NC}"
    exit 1
else
    echo -e "${RED}Deploy com problemas criticos - investigar imediatamente${NC}"
    exit 2
fi
