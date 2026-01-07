#!/bin/bash
# =============================================================================
# Alice Enterprise Platform - Production Volumes Setup & Permissions Fix
# =============================================================================
# Autor: Fillipe Guerra
# Data: 07 de Janeiro de 2026
# Versão: 1.0.0
#
# PROPÓSITO:
#   Script para corrigir permissões de volumes em servidores de produção.
#   Resolve problemas de restart loop causados por ownership incorreto.
#
# CASOS DE USO:
#   1. Primeiro deploy - configurar permissões corretas desde o início
#   2. Correção pós-deploy - ajustar volumes criados com ownership incorreto
#   3. Migração de servidor - recriar estrutura com permissões corretas
#
# EXECUÇÃO:
#   sudo ./setup-production-volumes.sh [--dry-run] [--fix-existing]
#
# OPÇÕES:
#   --dry-run        Mostra mudanças sem aplicar
#   --fix-existing   Corrige permissões de volumes existentes (PERIGOSO!)
#
# IDEMPOTÊNCIA:
#   - Pode ser executado múltiplas vezes sem problemas
#   - Verifica antes de criar/modificar
#   - Não sobrescreve dados existentes
#
# REFERÊNCIAS:
#   - CLAUDE.md Regra 6: Enterprise-grade, sem workarounds
#   - CLAUDE.md Regra 16: Fail-fast, validações robustas
#   - DEPLOYMENT.md Seção 8.2: Service-Specific Permissions
# =============================================================================

set -euo pipefail

# =============================================================================
# VARIÁVEIS GLOBAIS
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="/opt/alice"
DRY_RUN=false
FIX_EXISTING=false

# MAPA DE UIDs/GIDs POR SERVIÇO
# FONTE: Análise de imagens oficiais Docker + docs oficiais
declare -A SERVICE_UIDS=(
    ["postgres"]=70              # postgres:16-alpine
    ["jaeger"]=10001            # jaegertracing/jaeger:2.13.0
    ["grafana"]=472             # grafana/grafana:12.3.1
    ["prometheus"]=65534        # prom/prometheus:v3.8.1 (nobody)
    ["loki"]=10001              # grafana/loki:3.6.3
    ["clickhouse"]=101          # clickhouse/clickhouse-server:25.1.3.5-alpine
    ["langfuse-db"]=70          # postgres:16-alpine (Langfuse DB)
    ["redis-alice"]=999         # redis:7.4.7-alpine
    ["caddy"]=1000              # Custom Dockerfile (user caddy UID 1000)
    ["searxng"]=977             # searxng/searxng:2025.12.30-a5c946a32
    ["erpnext"]=1000            # Frappe Bench (UID 1000)
    ["mariadb"]=999             # mariadb:11.6.2-ubi9 (mysql user)
)

# =============================================================================
# FUNÇÕES AUXILIARES
# =============================================================================

log_info() {
    echo -e "\033[0;34m[INFO]\033[0m $*"
}

log_success() {
    echo -e "\033[0;32m[OK]\033[0m $*"
}

log_warn() {
    echo -e "\033[0;33m[WARN]\033[0m $*"
}

log_error() {
    echo -e "\033[0;31m[ERROR]\033[0m $*" >&2
}

log_section() {
    echo ""
    echo "============================================="
    echo "$*"
    echo "============================================="
}

print_usage() {
    cat << EOF
Uso: $0 [OPÇÕES]

OPÇÕES:
  --dry-run        Mostra mudanças sem aplicar (modo seguro)
  --fix-existing   Corrige permissões de volumes existentes
                   ⚠️  ATENÇÃO: Pode causar downtime se serviços estiverem rodando
  -h, --help       Mostra esta mensagem

EXEMPLOS:
  # Verificar sem fazer mudanças
  sudo $0 --dry-run

  # Criar estrutura para primeiro deploy
  sudo $0

  # Corrigir permissões de volumes existentes (com containers parados)
  sudo $0 --fix-existing

IMPORTANTE:
  - Script deve ser executado como root (sudo)
  - Para --fix-existing, PARE os containers antes de executar
  - Backup recomendado antes de usar --fix-existing

EOF
}

# =============================================================================
# VALIDAÇÕES PRÉ-REQUISITOS
# =============================================================================

validate_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "Este script DEVE ser executado como root (sudo)"
        exit 1
    fi
}

validate_production_server() {
    log_section "VALIDAÇÕES PRÉ-REQUISITOS"
    
    log_info "Validando servidor de produção..."
    
    if ! hostname -I | grep -qw "178.63.41.108"; then
        log_error "Este NÃO é o servidor de produção!"
        log_error "IPs encontrados: $(hostname -I)"
        log_error "IP esperado: 178.63.41.108"
        log_error "Este script DEVE ser executado no Production Server (Hetzner GEX44)."
        exit 1
    fi
    
    log_success "Servidor de produção correto (178.63.41.108)"
}

# =============================================================================
# FUNÇÕES DE CRIAÇÃO DE DIRETÓRIOS
# =============================================================================

create_directory() {
    local dir="$1"
    local uid="$2"
    local gid="$3"
    local mode="$4"
    local desc="$5"
    
    if [[ -d "$dir" ]] && [[ "$FIX_EXISTING" != true ]]; then
        # Diretório existe e não é modo fix - apenas validar
        local current_uid=$(stat -c '%u' "$dir")
        local current_gid=$(stat -c '%g' "$dir")
        local current_mode=$(stat -c '%a' "$dir")
        
        if [[ "$current_uid" != "$uid" ]] || [[ "$current_gid" != "$gid" ]] || [[ "$current_mode" != "$mode" ]]; then
            log_warn "$desc - ownership/permissions incorretos"
            log_warn "  Atual:    $current_uid:$current_gid ($current_mode)"
            log_warn "  Esperado: $uid:$gid ($mode)"
            log_warn "  Use --fix-existing para corrigir"
        else
            log_success "$desc - correto ($uid:$gid $mode)"
        fi
        return
    fi
    
    # Criar diretório ou corrigir existente
    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Criaria/corrigiria: $dir ($uid:$gid $mode) - $desc"
    else
        mkdir -p "$dir"
        chown "$uid:$gid" "$dir"
        chmod "$mode" "$dir"
        log_success "$desc configurado ($uid:$gid $mode)"
    fi
}

# =============================================================================
# CONFIGURAÇÃO DE PERMISSÕES POR SERVIÇO
# =============================================================================

setup_infra_stack() {
    log_section "INFRA STACK - Permissões"
    
    # PostgreSQL (UID 70 - postgres:16-alpine)
    # CRÍTICO: UID 70, NÃO 999!
    create_directory \
        "$BASE_DIR/data/postgres" \
        70 \
        70 \
        700 \
        "PostgreSQL data (UID 70 - postgres:16-alpine)"
    
    # Redis Alice (UID 999 - redis:7.4.7-alpine)
    create_directory \
        "$BASE_DIR/data/redis-alice" \
        999 \
        999 \
        755 \
        "Redis Alice data (UID 999)"
    
    # Qdrant (root - sem restrição specific)
    create_directory \
        "$BASE_DIR/data/qdrant" \
        0 \
        0 \
        755 \
        "Qdrant vector DB data (root)"
    
    # MinIO (root - sem restrição specific)
    create_directory \
        "$BASE_DIR/data/minio" \
        0 \
        0 \
        755 \
        "MinIO object storage data (root)"
    
    # Caddy (UID 1000 - custom Dockerfile)
    create_directory \
        "$BASE_DIR/data/caddy" \
        1000 \
        1000 \
        700 \
        "Caddy SSL certificates (UID 1000)"
    
    create_directory \
        "$BASE_DIR/data/caddy-config" \
        1000 \
        1000 \
        755 \
        "Caddy configuration (UID 1000)"
    
    create_directory \
        "$BASE_DIR/logs/caddy" \
        1000 \
        1000 \
        755 \
        "Caddy logs (UID 1000)"
    
    # SearXNG (UID 977 - searxng/searxng)
    create_directory \
        "$BASE_DIR/data/searxng-config" \
        977 \
        977 \
        755 \
        "SearXNG configuration (UID 977)"
    
    # pgBackRest spool
    create_directory \
        "$BASE_DIR/data/pgbackrest-spool" \
        70 \
        70 \
        755 \
        "pgBackRest spool (UID 70)"
}

setup_observability_stack() {
    log_section "OBSERVABILITY STACK - Permissões"
    
    # Prometheus (UID 65534 - nobody)
    create_directory \
        "$BASE_DIR/data/prometheus" \
        65534 \
        65534 \
        755 \
        "Prometheus data (UID 65534 - nobody)"
    
    # Grafana (UID 472 - oficial)
    create_directory \
        "$BASE_DIR/data/grafana" \
        472 \
        472 \
        755 \
        "Grafana data (UID 472)"
    
    # Loki (UID 10001 - grafana/loki)
    create_directory \
        "$BASE_DIR/data/loki" \
        10001 \
        10001 \
        755 \
        "Loki data (UID 10001)"
    
    # Jaeger (UID 10001 - jaegertracing/jaeger v2)
    # CRÍTICO: UID 10001, NÃO root!
    create_directory \
        "$BASE_DIR/data/jaeger" \
        10001 \
        10001 \
        755 \
        "Jaeger badger storage (UID 10001)"
    
    # ClickHouse (UID 101)
    create_directory \
        "$BASE_DIR/data/clickhouse" \
        101 \
        101 \
        755 \
        "ClickHouse data (UID 101)"
    
    create_directory \
        "$BASE_DIR/logs/clickhouse" \
        101 \
        101 \
        755 \
        "ClickHouse logs (UID 101)"
    
    # Langfuse DB PostgreSQL (UID 70)
    create_directory \
        "$BASE_DIR/data/langfuse-db" \
        70 \
        70 \
        755 \
        "Langfuse PostgreSQL data (UID 70)"
    
    # Vector (root - sem restrição specific)
    create_directory \
        "$BASE_DIR/data/vector" \
        0 \
        0 \
        755 \
        "Vector log aggregator data (root)"
    
    # Jaeger logs
    create_directory \
        "$BASE_DIR/logs/jaeger" \
        10001 \
        10001 \
        755 \
        "Jaeger logs (UID 10001)"
}

setup_erpnext_stack() {
    log_section "ERPNEXT STACK - Permissões"
    
    # ERPNext sites (UID 1000 - Frappe)
    create_directory \
        "$BASE_DIR/data/erpnext-sites" \
        1000 \
        1000 \
        755 \
        "ERPNext sites data (UID 1000 - Frappe)"
    
    create_directory \
        "$BASE_DIR/logs/erpnext" \
        1000 \
        1000 \
        755 \
        "ERPNext logs (UID 1000)"
    
    # MariaDB (UID 999 - mysql user)
    create_directory \
        "$BASE_DIR/data/erpnext-mariadb" \
        999 \
        999 \
        755 \
        "ERPNext MariaDB data (UID 999)"
    
    # Redis Cache e Queue (UID 999)
    create_directory \
        "$BASE_DIR/data/erpnext-redis-cache" \
        999 \
        999 \
        755 \
        "ERPNext Redis Cache (UID 999)"
    
    create_directory \
        "$BASE_DIR/data/erpnext-redis-queue" \
        999 \
        999 \
        755 \
        "ERPNext Redis Queue (UID 999)"
}

setup_backup_directories() {
    log_section "BACKUP - Permissões"
    
    # Backups PostgreSQL (UID 70 para pgBackRest)
    create_directory \
        "$BASE_DIR/backups/postgresql" \
        70 \
        70 \
        750 \
        "PostgreSQL backups (UID 70 - pgBackRest)"
    
    create_directory \
        "$BASE_DIR/backups/postgresql/logs" \
        70 \
        70 \
        750 \
        "pgBackRest logs (UID 70)"
    
    # Manifests de backup (root - gerados pelo observability-service)
    create_directory \
        "$BASE_DIR/backups/manifests" \
        0 \
        0 \
        750 \
        "Backup manifests (root)"
}

setup_shared_directories() {
    log_section "DIRETÓRIOS COMPARTILHADOS - Permissões"
    
    # Uploads (para RAG multimodal)
    create_directory \
        "$BASE_DIR/uploads" \
        0 \
        0 \
        755 \
        "Uploads multimodais (root - compartilhado)"
    
    create_directory \
        "$BASE_DIR/uploads/training" \
        0 \
        0 \
        755 \
        "Training datasets (root)"
    
    # Secrets (restrito)
    create_directory \
        "$BASE_DIR/secrets" \
        0 \
        0 \
        700 \
        "Secrets (root - acesso restrito)"
    
    # Versions (tracking de deploys)
    create_directory \
        "$BASE_DIR/versions" \
        0 \
        0 \
        755 \
        "Deploy version tracking (root)"
}

# =============================================================================
# RELATÓRIO FINAL
# =============================================================================

print_summary() {
    log_section "RESUMO"
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "Modo DRY-RUN - nenhuma mudança foi aplicada"
        log_info "Execute sem --dry-run para aplicar as configurações"
    elif [[ "$FIX_EXISTING" == true ]]; then
        log_success "Permissões de volumes existentes corrigidas!"
        log_warn "Reinicie os containers para aplicar as mudanças:"
        log_warn "  docker compose -f infra/docker/stacks/docker-compose.infra.yml restart"
        log_warn "  docker compose -f infra/docker/stacks/docker-compose.observability.yml restart"
    else
        log_success "Estrutura de volumes criada com permissões corretas!"
        log_info "Próximos passos:"
        log_info "  1. Executar deploy dos stacks"
        log_info "  2. Verificar logs dos containers para confirmar acesso aos volumes"
    fi
    
    echo ""
    log_info "Documentação de UIDs/GIDs por serviço:"
    echo ""
    printf "%-20s %-10s %s\n" "SERVIÇO" "UID:GID" "IMAGEM/DESCRIÇÃO"
    echo "-------------------------------------------------------------"
    printf "%-20s %-10s %s\n" "PostgreSQL" "70:70" "postgres:16-alpine"
    printf "%-20s %-10s %s\n" "Jaeger" "10001:10001" "jaegertracing/jaeger:2.13.0"
    printf "%-20s %-10s %s\n" "Grafana" "472:472" "grafana/grafana:12.3.1"
    printf "%-20s %-10s %s\n" "Prometheus" "65534:65534" "prom/prometheus (nobody)"
    printf "%-20s %-10s %s\n" "Loki" "10001:10001" "grafana/loki:3.6.3"
    printf "%-20s %-10s %s\n" "ClickHouse" "101:101" "clickhouse-server"
    printf "%-20s %-10s %s\n" "Redis Alice" "999:999" "redis:7.4.7-alpine"
    printf "%-20s %-10s %s\n" "Caddy" "1000:1000" "Custom Dockerfile"
    printf "%-20s %-10s %s\n" "SearXNG" "977:977" "searxng/searxng"
    printf "%-20s %-10s %s\n" "ERPNext" "1000:1000" "Frappe Bench"
    printf "%-20s %-10s %s\n" "MariaDB" "999:999" "mariadb:11.6.2-ubi9"
    echo ""
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    # Parse argumentos
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --fix-existing)
                FIX_EXISTING=true
                shift
                ;;
            -h|--help)
                print_usage
                exit 0
                ;;
            *)
                log_error "Opção desconhecida: $1"
                print_usage
                exit 1
                ;;
        esac
    done
    
    # Validações
    validate_root
    validate_production_server
    
    # Aviso para fix-existing
    if [[ "$FIX_EXISTING" == true ]] && [[ "$DRY_RUN" != true ]]; then
        log_warn "⚠️  MODO FIX-EXISTING ATIVADO"
        log_warn "Isso irá alterar permissões de volumes existentes!"
        log_warn "CERTIFIQUE-SE de que os containers estão PARADOS."
        echo ""
        read -p "Continuar? (sim/NÃO): " -r
        if [[ ! $REPLY =~ ^[Ss][Ii][Mm]$ ]]; then
            log_info "Operação cancelada pelo usuário"
            exit 0
        fi
    fi
    
    # Criar estrutura de diretórios base
    if [[ "$DRY_RUN" != true ]]; then
        mkdir -p "$BASE_DIR"/{data,logs,uploads,backups,secrets,versions}
    fi
    
    # Configurar permissões por stack
    setup_infra_stack
    setup_observability_stack
    setup_erpnext_stack
    setup_backup_directories
    setup_shared_directories
    
    # Relatório final
    print_summary
}

# Executar main
main "$@"
