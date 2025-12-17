#!/bin/bash
# =============================================================================
# Script de Limpeza Pós-Deploy Falho - Alice Enterprise Platform
# =============================================================================
# Descrição: Limpa recursos órfãos após um deploy que falhou, protegendo
#            dados de produção se houver versão rodando.
#
# Modos de operação:
#   --dry-run    : Mostra o que seria limpo (default)
#   --execute    : Executa a limpeza
#   --force      : Limpa mesmo com produção rodando (CUIDADO!)
#
# PROTEÇÕES ENTERPRISE:
# - NÃO remove volumes de dados (postgres, redis, qdrant)
# - NÃO remove containers saudáveis (healthy)
# - NÃO remove imagens em uso
# - Protege /opt/alice/data e /opt/alice/uploads
#
# Autor: Fillipe Guerra
# Data: 17 de Dezembro de 2025
# =============================================================================

set -euo pipefail

# Configurações
DRY_RUN=true
FORCE=false

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Contadores
CLEANED=0
PROTECTED=0

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[⚠]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }
log_dry() { echo -e "${CYAN}[DRY-RUN]${NC} $1"; }
log_protect() { echo -e "${GREEN}[PROTECTED]${NC} $1"; ((PROTECTED++)); }

# Parse argumentos
while [[ $# -gt 0 ]]; do
    case $1 in
        --execute|-e) DRY_RUN=false; shift ;;
        --force|-f) FORCE=true; shift ;;
        --dry-run|-d) DRY_RUN=true; shift ;;
        --help|-h)
            echo "Uso: $0 [--dry-run|--execute] [--force]"
            echo ""
            echo "Opções:"
            echo "  --dry-run, -d   Mostra o que seria limpo (default)"
            echo "  --execute, -e   Executa a limpeza"
            echo "  --force, -f     Força limpeza mesmo com produção rodando"
            exit 0
            ;;
        *) echo "Opção desconhecida: $1"; exit 1 ;;
    esac
done

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║     ALICE ENTERPRISE - LIMPEZA PÓS-DEPLOY FALHO                   ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "Data: $(date '+%Y-%m-%d %H:%M:%S')"
echo "Modo: $([ "$DRY_RUN" = true ] && echo 'DRY-RUN (simulação)' || echo 'EXECUTE (produção)')"
echo "Força: $FORCE"
echo ""

# =============================================================================
# VERIFICAR SE HÁ PRODUÇÃO RODANDO
# =============================================================================
log_info "Verificando se há versão de produção rodando..."

HEALTHY_CONTAINERS=$(docker ps --filter "health=healthy" --format '{{.Names}}' | grep -c "^alice-" || echo "0")
RUNNING_ALICE=$(docker ps --format '{{.Names}}' | grep -c "^alice-" || echo "0")

if [ "$RUNNING_ALICE" -gt 0 ] && [ "$FORCE" != true ]; then
    log_warn "Detectados $RUNNING_ALICE containers Alice rodando ($HEALTHY_CONTAINERS saudáveis)"
    log_warn "Use --force para limpar mesmo assim (CUIDADO com dados de produção!)"
    echo ""
    log_info "Containers ativos:"
    docker ps --filter "name=alice-" --format "  - {{.Names}}: {{.Status}}"
    echo ""
    
    if [ "$DRY_RUN" = true ]; then
        log_info "Continuando em modo dry-run para mostrar o que seria limpo..."
    else
        log_error "Abortando para proteger produção. Use --force se realmente necessário."
        exit 1
    fi
fi

# =============================================================================
# 1. CONTAINERS COM ERRO OU PARADOS
# =============================================================================
echo ""
log_info "═══ 1. CONTAINERS COM ERRO/PARADOS ═══"

# Containers com status exited ou dead
FAILED_CONTAINERS=$(docker ps -a --filter "status=exited" --filter "status=dead" --format '{{.Names}}' || true)

if [ -n "$FAILED_CONTAINERS" ]; then
    for container in $FAILED_CONTAINERS; do
        # Proteger containers de dados (db, redis) mesmo parados
        if [[ "$container" =~ (postgres|mariadb|redis|qdrant|langfuse-db) ]]; then
            log_protect "Container de dados: $container (não será removido)"
            continue
        fi
        
        if [ "$DRY_RUN" = true ]; then
            log_dry "Removeria container: $container"
        else
            docker rm -f "$container" 2>/dev/null || true
            log_ok "Container removido: $container"
            ((CLEANED++))
        fi
    done
else
    log_ok "Nenhum container falho encontrado"
fi

# =============================================================================
# 2. IMAGENS ÓRFÃS (DANGLING)
# =============================================================================
echo ""
log_info "═══ 2. IMAGENS ÓRFÃS ═══"

DANGLING_IMAGES=$(docker images -f "dangling=true" -q || true)
DANGLING_COUNT=$(echo "$DANGLING_IMAGES" | grep -c . || echo "0")

if [ "$DANGLING_COUNT" -gt 0 ]; then
    if [ "$DRY_RUN" = true ]; then
        log_dry "Removeria $DANGLING_COUNT imagens órfãs"
    else
        docker image prune -f >/dev/null 2>&1
        log_ok "Removidas $DANGLING_COUNT imagens órfãs"
        ((CLEANED++))
    fi
else
    log_ok "Nenhuma imagem órfã"
fi

# =============================================================================
# 3. NETWORKS ÓRFÃS
# =============================================================================
echo ""
log_info "═══ 3. NETWORKS ÓRFÃS ═══"

# Manter networks essenciais
PROTECTED_NETWORKS="alice-network|erpnext-network|bridge|host|none"

ORPHAN_NETWORKS=$(docker network ls --format '{{.Name}}' | grep -vE "^($PROTECTED_NETWORKS)$" || true)

if [ -n "$ORPHAN_NETWORKS" ]; then
    for net in $ORPHAN_NETWORKS; do
        # Verificar se network está em uso
        CONTAINERS_USING=$(docker network inspect "$net" --format '{{len .Containers}}' 2>/dev/null || echo "0")
        if [ "$CONTAINERS_USING" -gt 0 ]; then
            log_protect "Network em uso: $net ($CONTAINERS_USING containers)"
            continue
        fi
        
        if [ "$DRY_RUN" = true ]; then
            log_dry "Removeria network: $net"
        else
            docker network rm "$net" 2>/dev/null || true
            log_ok "Network removida: $net"
            ((CLEANED++))
        fi
    done
else
    log_ok "Nenhuma network órfã"
fi

# =============================================================================
# 4. ARQUIVOS TEMPORÁRIOS DE DEPLOY
# =============================================================================
echo ""
log_info "═══ 4. ARQUIVOS TEMPORÁRIOS ═══"

TEMP_FILES=(
    "/tmp/.env.prod"
    "/tmp/salad_endpoints.env"
    "/tmp/langfuse_db_password"
    "/tmp/alertmanager_smtp_password"
    "/tmp/.env.prod.tmp"
)

for file in "${TEMP_FILES[@]}"; do
    if [ -f "$file" ]; then
        if [ "$DRY_RUN" = true ]; then
            log_dry "Removeria arquivo: $file"
        else
            rm -f "$file"
            log_ok "Arquivo removido: $file"
            ((CLEANED++))
        fi
    fi
done

# =============================================================================
# 5. CACHE DOCKER (OPCIONAL - APENAS COM --force)
# =============================================================================
if [ "$FORCE" = true ]; then
    echo ""
    log_info "═══ 5. CACHE DOCKER (--force) ═══"
    
    if [ "$DRY_RUN" = true ]; then
        log_dry "Limparia build cache do Docker"
    else
        docker builder prune -f >/dev/null 2>&1 || true
        log_ok "Build cache limpo"
        ((CLEANED++))
    fi
fi

# =============================================================================
# 6. VERIFICAR ESPAÇO EM DISCO
# =============================================================================
echo ""
log_info "═══ 6. ESPAÇO EM DISCO ═══"

DISK_USAGE=$(df -h /opt 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%')
DISK_FREE=$(df -h /opt 2>/dev/null | awk 'NR==2{print $4}')

if [ "${DISK_USAGE:-0}" -gt 85 ]; then
    log_warn "Disco /opt: ${DISK_USAGE}% usado (${DISK_FREE} livre)"
    log_info "Considere executar: docker system prune -a"
else
    log_ok "Disco /opt: ${DISK_USAGE}% usado (${DISK_FREE} livre)"
fi

# =============================================================================
# RESUMO
# =============================================================================
echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                       RESUMO DA LIMPEZA                           ║${NC}"
echo -e "${CYAN}╠═══════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║  Modo:          $([ "$DRY_RUN" = true ] && echo 'DRY-RUN (nada foi removido)' || echo 'EXECUTE (limpeza realizada)')${CYAN}${NC}"
echo -e "${CYAN}║  ${GREEN}Protegidos:${NC}    $PROTECTED                                            ${CYAN}║${NC}"
echo -e "${CYAN}║  ${YELLOW}Limpos/A limpar:${NC} $CLEANED                                            ${CYAN}║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}→ Execute com --execute para realizar a limpeza${NC}"
fi
