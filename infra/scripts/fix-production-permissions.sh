#!/usr/bin/env bash
# =============================================================================
# Script: fix-production-permissions.sh
# Versão: 1.0.0
# Data: 07 de Janeiro de 2026
# Autor: Fillipe Guerra
# =============================================================================
# PROPÓSITO: Criar estrutura de diretórios de dados com permissões corretas
#            para todos os containers da plataforma Alice Enterprise.
#
# PROBLEMA RESOLVIDO: Deploy em produção falhava porque diretórios de dados
#                     não existiam ou tinham permissões incorretas, causando
#                     restart loops infinitos em PostgreSQL, Jaeger e outros.
#
# USO:
#   ./fix-production-permissions.sh --dry-run    # Preview das mudanças
#   ./fix-production-permissions.sh --create     # Criar diretórios e permissões
#   ./fix-production-permissions.sh --validate   # Validar permissões existentes
#
# REFERÊNCIAS:
#   - CLAUDE.md Regra 6: Enterprise-grade, sem workarounds
#   - CLAUDE.md Regra 11: Melhores práticas 2025 - UIDs explícitos
#   - CLAUDE.md Regra 12: Deploy Hetzner GPU
#   - docs/DEPLOYMENT.md: Estrutura de diretórios
# =============================================================================

set -euo pipefail

# =============================================================================
# CONFIGURAÇÃO
# =============================================================================

# Base path para todos os dados
readonly BASE_DIR="/opt/alice"
readonly DATA_DIR="${BASE_DIR}/data"
readonly LOGS_DIR="${BASE_DIR}/logs"
readonly BACKUPS_DIR="${BASE_DIR}/backups"
readonly UPLOADS_DIR="${BASE_DIR}/uploads"
readonly SECRETS_DIR="${BASE_DIR}/secrets"

# Cores para output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Modo de operação
MODE=""

# =============================================================================
# DEFINIÇÃO DE DIRETÓRIOS E PERMISSÕES
# =============================================================================
# Formato: "path:uid:gid:permissions"
# 
# UIDs de containers Docker:
#   - postgres/mariadb: 999
#   - pgbackrest (pgbackrest Bitnami): 70
#   - redis: 999
#   - caddy: 1000
#   - searxng: 977
#   - jaeger: 10001
#   - clickhouse: 101
#   - grafana (Bitnami): 472
#   - prometheus: 65534 (nobody)
#   - alice uploads: 1000 (Node.js containers rodam como node user)
# =============================================================================
declare -a DIRECTORIES=(
    # INFRA STACK
    "${DATA_DIR}/postgres:999:999:700"
    "${DATA_DIR}/pgbackrest-spool:70:70:755"
    "${DATA_DIR}/redis-alice:999:999:755"
    "${DATA_DIR}/caddy:1000:1000:755"
    "${DATA_DIR}/caddy-config:1000:1000:755"
    "${DATA_DIR}/searxng-config:977:977:755"
    "${DATA_DIR}/minio:0:0:755"
    "${DATA_DIR}/qdrant:0:0:755"
    
    # OBSERVABILITY STACK
    "${DATA_DIR}/jaeger:10001:10001:755"
    "${DATA_DIR}/langfuse-db:70:70:700"
    "${DATA_DIR}/clickhouse:101:101:755"
    "${DATA_DIR}/vector:0:0:755"
    
    # ERPNEXT STACK
    "${DATA_DIR}/erpnext-sites:1000:1000:755"
    "${DATA_DIR}/erpnext-mariadb:999:999:755"
    "${DATA_DIR}/erpnext-redis-cache:999:999:755"
    "${DATA_DIR}/erpnext-redis-queue:999:999:755"
    
    # LOGS
    "${LOGS_DIR}/caddy:1000:1000:755"
    "${LOGS_DIR}/erpnext:1000:1000:755"
    "${LOGS_DIR}/clickhouse:101:101:755"
    
    # BACKUPS
    "${BACKUPS_DIR}/postgresql:999:999:755"
    
    # UPLOADS (alice microservices)
    "${UPLOADS_DIR}:1000:1000:755"
    
    # SECRETS
    "${SECRETS_DIR}:0:0:700"
)

# =============================================================================
# FUNÇÕES DE UTILIDADE
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $*"
}

log_warning() {
    echo -e "${YELLOW}[⚠]${NC} $*"
}

log_error() {
    echo -e "${RED}[✗]${NC} $*"
}

print_banner() {
    echo ""
    echo "============================================================================="
    echo "  Alice Enterprise - Production Permissions Setup"
    echo "  Versão: 1.0.0 | Data: 07/01/2026"
    echo "============================================================================="
    echo ""
}

print_usage() {
    cat << EOF
Uso: $(basename "$0") [MODO]

MODOS:
  --dry-run    Preview das mudanças sem executar
  --create     Criar diretórios e aplicar permissões
  --validate   Validar permissões existentes

EXEMPLOS:
  $(basename "$0") --dry-run     # Ver o que será criado
  $(basename "$0") --create      # Executar criação real
  $(basename "$0") --validate    # Verificar se permissões estão corretas

NOTA: Requer privilégios de root para modificar ownership/permissions.
EOF
    exit 1
}

# =============================================================================
# FUNÇÕES DE OPERAÇÃO
# =============================================================================

dry_run_mode() {
    log_info "Modo DRY-RUN - Nenhuma mudança será aplicada"
    echo ""
    
    for entry in "${DIRECTORIES[@]}"; do
        IFS=':' read -r path uid gid perms <<< "$entry"
        
        if [[ -d "$path" ]]; then
            current_uid=$(stat -c '%u' "$path")
            current_gid=$(stat -c '%g' "$path")
            current_perms=$(stat -c '%a' "$path")
            
            if [[ "$current_uid" == "$uid" ]] && [[ "$current_gid" == "$gid" ]] && [[ "$current_perms" == "$perms" ]]; then
                log_success "OK: $path (${uid}:${gid} ${perms})"
            else
                log_warning "MUDARIA: $path"
                echo "          Atual: ${current_uid}:${current_gid} ${current_perms}"
                echo "          Novo:  ${uid}:${gid} ${perms}"
            fi
        else
            log_info "CRIARIA: $path (${uid}:${gid} ${perms})"
        fi
    done
    
    echo ""
    log_info "Total de diretórios: ${#DIRECTORIES[@]}"
}

create_mode() {
    log_info "Modo CREATE - Aplicando mudanças reais"
    echo ""
    
    local created=0
    local modified=0
    local unchanged=0
    local failed=0
    
    for entry in "${DIRECTORIES[@]}"; do
        IFS=':' read -r path uid gid perms <<< "$entry"
        
        # Criar diretório se não existir
        if [[ ! -d "$path" ]]; then
            if mkdir -p "$path" 2>/dev/null; then
                log_success "Criado: $path"
                ((created++))
            else
                log_error "Falha ao criar: $path"
                ((failed++))
                continue
            fi
        fi
        
        # Verificar permissões atuais
        current_uid=$(stat -c '%u' "$path")
        current_gid=$(stat -c '%g' "$path")
        current_perms=$(stat -c '%a' "$path")
        
        local needs_update=false
        
        # Atualizar ownership se necessário
        if [[ "$current_uid" != "$uid" ]] || [[ "$current_gid" != "$gid" ]]; then
            if chown "${uid}:${gid}" "$path" 2>/dev/null; then
                log_success "Ownership atualizado: $path → ${uid}:${gid}"
                needs_update=true
            else
                log_error "Falha ao atualizar ownership: $path"
                ((failed++))
                continue
            fi
        fi
        
        # Atualizar permissões se necessário
        if [[ "$current_perms" != "$perms" ]]; then
            if chmod "$perms" "$path" 2>/dev/null; then
                log_success "Permissões atualizadas: $path → ${perms}"
                needs_update=true
            else
                log_error "Falha ao atualizar permissões: $path"
                ((failed++))
                continue
            fi
        fi
        
        if [[ "$needs_update" == "true" ]]; then
            ((modified++))
        else
            ((unchanged++))
        fi
    done
    
    echo ""
    log_info "=========================================="
    log_info "RESUMO:"
    log_success "  Criados: $created"
    log_success "  Modificados: $modified"
    log_info "  Inalterados: $unchanged"
    if [[ $failed -gt 0 ]]; then
        log_error "  Falhas: $failed"
        return 1
    fi
    log_info "=========================================="
    
    return 0
}

validate_mode() {
    log_info "Modo VALIDATE - Verificando permissões"
    echo ""
    
    local valid=0
    local invalid=0
    local missing=0
    
    for entry in "${DIRECTORIES[@]}"; do
        IFS=':' read -r path uid gid perms <<< "$entry"
        
        if [[ ! -d "$path" ]]; then
            log_error "FALTA: $path não existe"
            ((missing++))
            continue
        fi
        
        current_uid=$(stat -c '%u' "$path")
        current_gid=$(stat -c '%g' "$path")
        current_perms=$(stat -c '%a' "$path")
        
        if [[ "$current_uid" == "$uid" ]] && [[ "$current_gid" == "$gid" ]] && [[ "$current_perms" == "$perms" ]]; then
            log_success "VÁLIDO: $path (${uid}:${gid} ${perms})"
            ((valid++))
        else
            log_error "INVÁLIDO: $path"
            echo "          Esperado: ${uid}:${gid} ${perms}"
            echo "          Atual:    ${current_uid}:${current_gid} ${current_perms}"
            ((invalid++))
        fi
    done
    
    echo ""
    log_info "=========================================="
    log_info "RESUMO:"
    log_success "  Válidos: $valid"
    if [[ $invalid -gt 0 ]]; then
        log_error "  Inválidos: $invalid"
    fi
    if [[ $missing -gt 0 ]]; then
        log_error "  Faltando: $missing"
    fi
    log_info "=========================================="
    
    if [[ $invalid -gt 0 ]] || [[ $missing -gt 0 ]]; then
        log_error "Validação FALHOU - execute com --create para corrigir"
        return 1
    else
        log_success "Validação PASSOU - todos os diretórios estão corretos"
        return 0
    fi
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    print_banner
    
    # Parse argumentos
    if [[ $# -ne 1 ]]; then
        print_usage
    fi
    
    MODE="$1"
    
    case "$MODE" in
        --dry-run)
            dry_run_mode
            ;;
        --create)
            # Verificar se é root
            if [[ $EUID -ne 0 ]]; then
                log_error "Este script requer privilégios de root para modificar ownership/permissions"
                log_info "Execute com: sudo $0 --create"
                exit 1
            fi
            
            if create_mode; then
                log_success "Operação concluída com sucesso!"
                exit 0
            else
                log_error "Operação concluída com erros"
                exit 1
            fi
            ;;
        --validate)
            if validate_mode; then
                exit 0
            else
                exit 1
            fi
            ;;
        *)
            log_error "Modo desconhecido: $MODE"
            print_usage
            ;;
    esac
}

main "$@"
