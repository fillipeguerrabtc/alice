#!/usr/bin/env bash
# =============================================================================
# Script: fix-production-permissions.sh
# Versão: 1.1.0
# Data: 09 de Janeiro de 2026
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

# Obter diretório do script para source do SSOT
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# =============================================================================
# SOURCE SSOT (Single Source of Truth)
# =============================================================================
# CORREÇÃO ENTERPRISE 09/01/2026:
#
# CAUSA RAIZ IDENTIFICADA:
#   - Dois scripts (prepare-production-server.sh e fix-production-permissions.sh)
#     gerenciavam as mesmas permissões com valores DIFERENTES
#   - prepare-production-server.sh: langfuse-db=755, caddy=700, backups/postgresql=750
#   - fix-production-permissions.sh: langfuse-db=700, caddy=755, backups/postgresql=755
#   - RESULTADO: Validação sempre falhava por inconsistência
#
# SOLUÇÃO ENTERPRISE:
#   - SSOT (Single Source of Truth) em permissions-config.sh
#   - Ambos os scripts fazem source do mesmo arquivo
#   - Zero duplicação, zero inconsistência
#
# REF: CLAUDE.md Regra 2 (Não duplicar), Regra 6 (Enterprise-grade)
# REF: docs/PERMISSIONS.md para documentação completa
# =============================================================================
if [[ -f "${SCRIPT_DIR}/permissions-config.sh" ]]; then
    # shellcheck source=permissions-config.sh
    source "${SCRIPT_DIR}/permissions-config.sh"
else
    echo "❌ ERRO CRÍTICO: permissions-config.sh não encontrado em ${SCRIPT_DIR}"
    echo "   Este arquivo é o SSOT (Single Source of Truth) para permissões."
    echo "   REF: CLAUDE.md Regra 2 (Não duplicar)"
    exit 1
fi

# Criar aliases para compatibilidade com código existente
readonly BASE_DIR="${ALICE_BASE_DIR}"
readonly DATA_DIR="${ALICE_DATA_DIR}"
readonly LOGS_DIR="${ALICE_LOGS_DIR}"
readonly BACKUPS_DIR="${ALICE_BACKUPS_DIR}"
readonly UPLOADS_DIR="${ALICE_UPLOADS_DIR}"
readonly SECRETS_DIR="${ALICE_SECRETS_DIR}"

# Usar PERMISSIONS_CONFIG do SSOT
declare -a DIRECTORIES=("${PERMISSIONS_CONFIG[@]}")

# Cores para output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Constantes de validação
readonly MAX_WRONG_FILES_DISPLAY=5  # Máximo de arquivos incorretos a mostrar por diretório

# Modo de operação
MODE=""

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
# FUNÇÕES AUXILIARES PARA EXCEÇÕES
# =============================================================================
# NOTA: Estas funções DEVEM ser definidas ANTES das funções de modo
#       (dry_run_mode, create_mode, validate_mode) que as utilizam.
# =============================================================================

# =============================================================================
# FUNÇÃO: is_validation_exception
# =============================================================================
# PROPÓSITO: Verificar se path é uma exceção conhecida de multi-UID legítimo
#
# PARÂMETROS:
#   $1 - file_path: Caminho do arquivo/diretório a verificar
#   $2 - expected_uid: UID esperado do diretório pai
#   $3 - expected_gid: GID esperado do diretório pai
#
# RETORNO:
#   0 - Path é exceção válida (ignorar na validação)
#   1 - Path NÃO é exceção (validar normalmente)
#
# EXEMPLO:
#   /opt/alice/backups/postgresql/        (70:70) ✅ Parent correto (Alpine)
#   └── logs/                             (70:70) ✅ Mesmo UID após migração Alpine
#
# REF: CLAUDE.md Regra 6 (Enterprise-grade), VALIDATION_EXCEPTIONS map
# =============================================================================
is_validation_exception() {
    local file_path="$1"
    local expected_uid="$2"
    local expected_gid="$3"
    
    for exception_path in "${!VALIDATION_EXCEPTIONS[@]}"; do
        # =================================================================
        # CORREÇÃO BUG #1 (PR#84 - 08/01/2026): Padrão de match preciso
        # =================================================================
        # PROBLEMA ANTERIOR: Padrão "$exception_path"* fazia match de strings
        #                    que COMEÇAM com exception_path, mas não são descendants.
        #                    Ex: /logs-backup/ incorretamente matchava /logs
        #
        # SOLUÇÃO: Verificar match EXATO ou descendente (com separador /)
        #          - Match exato: file_path == exception_path
        #          - Descendente: file_path == exception_path/*
        #
        # REF: CLAUDE.md Regra 6 (Enterprise-grade), Regra 7 (Causa raiz)
        # =================================================================
        if [[ "$file_path" == "$exception_path" || "$file_path" == "$exception_path"/* ]]; then
            local exception_ownership="${VALIDATION_EXCEPTIONS[$exception_path]}"
            local exception_uid="${exception_ownership%%:*}"
            local exception_gid="${exception_ownership##*:}"
            
            # Verificar se arquivo tem ownership da exceção
            local actual_uid
            local actual_gid
            actual_uid=$(stat -c '%u' "$file_path" 2>/dev/null || stat -f '%u' "$file_path" 2>/dev/null || echo "unknown")
            actual_gid=$(stat -c '%g' "$file_path" 2>/dev/null || stat -f '%g' "$file_path" 2>/dev/null || echo "unknown")
            
            if [[ "$actual_uid" == "$exception_uid" ]] && [[ "$actual_gid" == "$exception_gid" ]]; then
                return 0  # É exceção válida, ignorar
            fi
        fi
    done
    
    return 1  # Não é exceção, validar normalmente
}

# =============================================================================
# FUNÇÃO: get_find_exclusions_for_path
# =============================================================================
# PROPÓSITO: Gerar argumentos de exclusão do find para paths de exceção
#
# CORREÇÃO BUG #2 (PR#83 - 08/01/2026):
#   PROBLEMA: create_mode() usava chown -R que sobrescrevia ownership legítimo
#             de subdiretórios exceção (ex: logs/ 70:70 dentro de postgresql/ 70:70)
#   SOLUÇÃO: Excluir paths de exceção do find que detecta arquivos incorretos
#
# CORREÇÃO BUG #2 (PR#85 - 08/01/2026):
#   PROBLEMA ANTERIOR: Função excluía TODOS os arquivos em paths de exceção
#                      baseado APENAS no path, sem verificar ownership.
#                      Arquivos com ownership incorreto (ex: 80:80 ao invés
#                      de 70:70) em diretórios de exceção eram silenciosamente
#                      ignorados, tornando is_validation_exception() código morto.
#   SOLUÇÃO: Excluir apenas arquivos que TANTO estão no path de exceção
#            QUANTO têm o ownership CORRETO da exceção.
#            Arquivos em paths de exceção com ownership incorreto NÃO são
#            excluídos e serão reportados como erros.
#
# PARÂMETROS:
#   $1 - base_path: Diretório base sendo verificado
#
# RETORNO (stdout):
#   String com argumentos -not para cada exceção aplicável
#
# EXEMPLO:
#   get_find_exclusions_for_path "/opt/alice/backups/postgresql"
#   # Retorna exclusões que consideram path E ownership:
#   # -not \( -path "/opt/alice/backups/postgresql/logs" -user 70 -group 70 \)
#   # -not \( -path "/opt/alice/backups/postgresql/logs/*" -user 70 -group 70 \)
#
# REF: CLAUDE.md Regra 6 (Enterprise-grade), find(1) man page
# =============================================================================
get_find_exclusions_for_path() {
    local base_path="$1"
    local exclusions=""
    
    for exception_path in "${!VALIDATION_EXCEPTIONS[@]}"; do
        # Verificar se a exceção está dentro do base_path
        if [[ "$exception_path" == "$base_path"/* ]]; then
            # Extrair UID e GID esperados da exceção
            local exception_ownership="${VALIDATION_EXCEPTIONS[$exception_path]}"
            local exception_uid="${exception_ownership%%:*}"
            local exception_gid="${exception_ownership##*:}"
            
            # =================================================================
            # CORREÇÃO BUG #2 (PR#85): Excluir apenas se path E ownership corretos
            # =================================================================
            # Exclui arquivos que:
            #   1. Estão no path de exceção (ou descendentes)
            #   2. E têm o ownership CORRETO da exceção
            #
            # Arquivos em paths de exceção com ownership INCORRETO (ex: 80:80
            # ao invés de 70:70) NÃO são excluídos e serão reportados.
            # =================================================================
            exclusions+=" -not \\( -path \"${exception_path}\" -user ${exception_uid} -group ${exception_gid} \\)"
            exclusions+=" -not \\( -path \"${exception_path}/*\" -user ${exception_uid} -group ${exception_gid} \\)"
        fi
    done
    
    echo "$exclusions"
}

# =============================================================================
# FUNÇÃO: find_wrong_files_excluding_exceptions
# =============================================================================
# PROPÓSITO: Encontrar arquivos com ownership incorreto, excluindo exceções
#
# PARÂMETROS:
#   $1 - path: Diretório a verificar
#   $2 - uid: UID esperado
#   $3 - gid: GID esperado
#   $4 - limit: Número máximo de resultados (0 = todos)
#
# RETORNO (stdout):
#   Lista de arquivos com ownership incorreto (excluindo exceções)
#
# REF: CLAUDE.md Regra 6 (Enterprise-grade)
# =============================================================================
find_wrong_files_excluding_exceptions() {
    local path="$1"
    local uid="$2"
    local gid="$3"
    local limit="${4:-0}"
    
    local exclusions
    exclusions=$(get_find_exclusions_for_path "$path")
    
    local find_cmd="find \"$path\" \\( ! -user \"$uid\" -o ! -group \"$gid\" \\) $exclusions"
    
    if [[ "$limit" -gt 0 ]]; then
        find_cmd+=" | head -n $limit"
    fi
    
    # Executar comando com eval para expandir exclusões corretamente
    eval "$find_cmd" 2>/dev/null
}

# =============================================================================
# FUNÇÕES DE OPERAÇÃO
# =============================================================================

dry_run_mode() {
    log_info "Modo DRY-RUN - Nenhuma mudança será aplicada"
    echo ""
    
    local changes=0
    
    for entry in "${DIRECTORIES[@]}"; do
        IFS=':' read -r path uid gid perms <<< "$entry"
        
        if [[ ! -d "$path" ]]; then
            log_warning "  ⚠️  CRIARIA: $path (${uid}:${gid} ${perms})"
            ((changes++))
            continue
        fi
        
        log_info "🔍 Verificando: $(basename "$path")..."
        
        # ==========================================================================
        # CORREÇÃO BUG CURSOR REVIEW (PR#76): Verificação recursiva em dry-run
        # ==========================================================================
        # BUG ORIGINAL (PR#74):
        #   - create_mode e validate_mode foram corrigidos para usar find (recursivo)
        #   - dry_run_mode AINDA USAVA stat (só pai) - INCONSISTÊNCIA CRÍTICA
        #
        # IMPACTO:
        #   - dry-run reportava "OK" quando pai tinha UID correto mas filhos errados
        #   - Usuário executava --create e descobria mudanças NÃO previstas
        #   - Perda de confiança no --dry-run (preview inútil)
        #
        # SOLUÇÃO:
        #   - Aplicar MESMA LÓGICA de create_mode/validate_mode
        #   - Usar find para verificar RECURSIVAMENTE
        #   - Consistência entre os 3 modos
        #
        # CORREÇÃO PR#83 (08/01/2026): Integrar VALIDATION_EXCEPTIONS
        #   - Usar find_wrong_files_excluding_exceptions() para excluir exceções
        #   - Consistência total entre dry_run, create e validate
        # ==========================================================================
        
        # Verificar se há arquivos com UID/GID incorreto (excluindo exceções)
        local wrong_files
        wrong_files=$(find_wrong_files_excluding_exceptions "$path" "$uid" "$gid" 1)
        
        if [[ -n "$wrong_files" ]]; then
            log_warning "  🔧 MUDARIA: chown (seletivo, excluindo exceções) $uid:$gid em arquivos incorretos de $path"
            log_info "     Primeiro arquivo incorreto: $wrong_files"
            ((changes++))
        else
            log_success "  ✅ OK: Ownership correto (verificado recursivamente, exceções preservadas)"
        fi
        
        # Verificar permissões do diretório pai
        local current_perms
        current_perms=$(stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path" 2>/dev/null)

        # Detectar bits especiais (setuid/setgid/sticky)
        local current_perms_normalized="${current_perms: -3}"
        local has_special_bits=false
        [[ "${#current_perms}" -gt 3 ]] && has_special_bits=true

        if [[ "$current_perms_normalized" != "$perms" ]] || [[ "$has_special_bits" == "true" ]]; then
            log_warning "  🔧 MUDARIA: chmod 0$perms $path (atual: $current_perms)"
            if [[ "$has_special_bits" == "true" ]]; then
                log_info "     NOTA: Bits especiais serão removidos (setuid/setgid/sticky)"
            fi
            ((changes++))
        fi
    done
    
    echo ""
    if [[ $changes -eq 0 ]]; then
        log_success "✅ Nenhuma mudança necessária - todas as permissões estão corretas"
    else
        log_info "📊 Total de mudanças que seriam feitas: $changes"
        echo ""
        log_info "💡 Para aplicar as mudanças, execute:"
        log_info "   sudo $0 --create"
    fi
    
    return 0
}

create_mode() {
    log_info "Modo CREATE - Aplicando mudanças reais"
    log_info "PostgreSQL UID detectado automaticamente: ${POSTGRES_UID} (${POSTGRES_UID}:${POSTGRES_GID})"
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
        
        # ==========================================================================
        # CORREÇÃO BUG CURSOR REVIEW (PR#74): Verificação recursiva ANTES de chown -R
        # ==========================================================================
        # BUG ORIGINAL:
        #   - create_mode verificava SOMENTE o diretório pai (stat)
        #   - validate_mode verificava SOMENTE o diretório pai (stat)
        #   - Se arquivos filhos tivessem UID errado, NUNCA eram corrigidos
        #
        # CENÁRIO DE FALHA:
        #   /opt/alice/data/postgres/        (70:70)    ✅ Pai correto (Alpine)
        #   ├── base/                        (root:root) ❌ Filho errado
        #   └── PG_VERSION                   (root:root) ❌ Arquivo errado
        #   
        #   Execução 1: stat vê 70:70 no pai → não roda chown -R → filhos errados
        #   Execução 2: stat vê 70:70 no pai → não roda chown -R → filhos errados (LOOP!)
        #
        # SOLUÇÃO:
        #   - Usar find para verificar RECURSIVAMENTE antes de decidir
        #   - Se encontrar qualquer arquivo com UID errado, rodar chown -R
        #   - Mesma lógica de verificação entre create e validate (consistência)
        #
        # PERFORMANCE:
        #   - find ... -print -quit: Para após encontrar primeiro erro (rápido)
        #   - Em diretórios corretos (~99% dos casos): ~10-50ms
        #   - Em diretórios grandes com erros: chown -R inevitável de qualquer forma
        # ==========================================================================
        
        log_info "  🔍 Verificando ownership recursivo: $(basename "$path")..."
        
        # ==========================================================================
        # CORREÇÃO BUG #2 (PR#83 - 08/01/2026): Respeitar VALIDATION_EXCEPTIONS
        # ==========================================================================
        # PROBLEMA ORIGINAL:
        #   - find detectava arquivos de exceção como "errados"
        #   - chown -R sobrescrevia ownership legítimo de exceções
        #   - Ex: logs/ (70:70) dentro de postgresql/ era alterado para outro UID
        #
        # SOLUÇÃO:
        #   - Usar find_wrong_files_excluding_exceptions() que exclui paths de exceção
        #   - Aplicar chown seletivamente (não -R cego) excluindo exceções
        #   - Preserva ownership legítimo de estruturas multi-UID
        # ==========================================================================
        
        # Verificar se há arquivos com UID/GID incorreto (excluindo exceções)
        local wrong_files
        wrong_files=$(find_wrong_files_excluding_exceptions "$path" "$uid" "$gid" 1)
        
        local needs_update=false
        
        if [[ -n "$wrong_files" ]]; then
            # Se chegou aqui, há pelo menos um arquivo com ownership errado (não é exceção)
            log_warning "  🔧 Encontrou arquivos com ownership incorreto, corrigindo..."
            log_info "     Exemplo de arquivo incorreto: ${wrong_files}"
            
            # =================================================================
            # CORREÇÃO BUG #2: Aplicar chown SELETIVAMENTE (excluindo exceções)
            # =================================================================
            # Usar find com -exec chown ao invés de chown -R cego
            # Isso preserva ownership de paths de exceção (multi-UID legítimo)
            # =================================================================
            local exclusions
            exclusions=$(get_find_exclusions_for_path "$path")
            
            local chown_cmd="find \"$path\" \\( ! -user \"$uid\" -o ! -group \"$gid\" \\) $exclusions -exec chown \"${uid}:${gid}\" {} \\;"
            
            if ! eval "$chown_cmd" 2>/dev/null; then
                log_error "  ❌ Falha ao atualizar ownership: $path"
                ((failed++))
                continue
            fi
            
            log_success "  ✅ Ownership corrigido (excluindo exceções multi-UID): $path → ${uid}:${gid}"
            needs_update=true
        else
            # Nenhum arquivo com ownership errado - tudo correto (pai E filhos)!
            log_success "  ✅ Ownership correto (verificado recursivamente): $(basename "$path")"
        fi
        
        # =======================================================================
        # CORREÇÃO BUG CURSOR REVIEW (PR#77): Sintaxe cross-platform para stat
        # =======================================================================
        # PROBLEMA ORIGINAL:
        #   - create_mode usava stat -c '%a' (SOMENTE Linux)
        #   - Em macOS, current_perms ficava vazio, causando chmod desnecessário
        #   - Inconsistência com dry_run_mode (que já usava sintaxe cross-platform)
        #
        # SOLUÇÃO:
        #   - Padronizar TODOS os modos com mesma sintaxe cross-platform
        #   - stat -c '%a' (Linux) || stat -f '%Lp' (macOS)
        #   - Consistência: dry_run, create e validate usam mesma lógica
        #
        # BENEFÍCIOS:
        #   - Desenvolvedores Mac podem testar script localmente
        #   - chmod só roda quando necessário (eficiente)
        #   - Zero impacto em produção (Linux continua usando primeiro comando)
        # =======================================================================
        
        # Verificar permissões do diretório pai (cross-platform)
        local current_perms
        current_perms=$(stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path" 2>/dev/null)
        
        # Atualizar permissões se necessário
        # ==========================================================================
        # CORREÇÃO BUG CRÍTICO (09/01/2026): Remoção agressiva de bits especiais
        # ==========================================================================
        # PROBLEMA: chmod 0755 em alguns sistemas/filesystems não remove setgid bit
        #           mesmo com prefixo 0. Isso causa validação falhar após create.
        # SOLUÇÃO: 
        #   1. Remover bits especiais EXPLICITAMENTE com chmod a-st (remove sticky, setgid, setuid)
        #   2. Depois aplicar permissões desejadas com chmod 0xxx
        #   3. Validar IMEDIATAMENTE após chmod para fail-fast
        # REF: chmod(1) man page, CLAUDE.md Regra 7 (Causa raiz), Regra 9 (Validação)
        # ==========================================================================
        # Normalizar permissões: extrair últimos 3 dígitos (ignorar bits especiais)
        local current_perms_normalized="${current_perms: -3}"
        local has_special_bits=false
        [[ "${#current_perms}" -gt 3 ]] && has_special_bits=true
        
        if [[ "$current_perms_normalized" != "$perms" ]] || [[ "$has_special_bits" == "true" ]]; then
            # =================================================================
            # PASSO 1: Remover bits especiais EXPLICITAMENTE
            # =================================================================
            # chmod a-st remove: setuid (s user), setgid (s group), sticky (t)
            # Isso garante que mesmo em filesystems com comportamento especial,
            # os bits serão removidos antes de aplicar as permissões finais.
            # =================================================================
            if [[ "$has_special_bits" == "true" ]]; then
                chmod a-st "$path" 2>/dev/null || true
            fi
            
            # =================================================================
            # PASSO 2: Aplicar permissões desejadas
            # =================================================================
            if ! chmod "0${perms}" "$path" 2>/dev/null; then
                log_error "  ❌ Falha ao atualizar permissões: $path"
                ((failed++))
                continue
            fi
            
            # =================================================================
            # PASSO 3: Validar IMEDIATAMENTE após chmod (fail-fast)
            # =================================================================
            # CORREÇÃO BUG (09/01/2026): Em alguns sistemas, chmod reporta sucesso
            # mas permissões não são alteradas (ACLs, mount options, etc.)
            # Validação imediata detecta isso antes de continuar.
            # =================================================================
            local new_perms
            new_perms=$(stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path" 2>/dev/null)
            local new_perms_normalized="${new_perms: -3}"
            local still_has_special=false
            [[ "${#new_perms}" -gt 3 ]] && still_has_special=true
            
            if [[ "$new_perms_normalized" != "$perms" ]] || [[ "$still_has_special" == "true" ]]; then
                log_error "  ❌ FALHA CRÍTICA: chmod não funcionou corretamente em $path"
                log_error "     Permissões antes: ${current_perms}"
                log_error "     Permissões após:  ${new_perms}"
                log_error "     Esperado:         0${perms}"
                log_error ""
                log_error "     DIAGNÓSTICO: Possíveis causas:"
                log_error "     - ACLs no filesystem (getfacl $path)"
                log_error "     - Mount options especiais (mount | grep $(df $path | tail -1 | awk '{print \$1}'))"
                log_error "     - SELinux/AppArmor (getenforce, aa-status)"
                log_error "     - chattr immutable (lsattr $path)"
                ((failed++))
                continue
            fi
            
            log_success "  ✅ Permissões atualizadas de ${current_perms} para 0${perms}: $path"
            needs_update=true
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
        
        # ==========================================================================
        # CORREÇÃO BUG CURSOR REVIEW (PR#74): Mesma lógica de verificação do create
        # ==========================================================================
        # Usar find com -print -quit para:
        # 1. Consistência: Mesma lógica de verificação entre create e validate
        # 2. Performance: Para após encontrar primeiro erro (não precisa listar todos)
        # 3. Clareza: Se validação falha, usuário sabe exatamente qual arquivo está errado
        # ==========================================================================
        
        log_info "  🔍 Validando ownership recursivo: $(basename "$path")..."
        
        # ==========================================================================
        # CORREÇÃO BUG #3 (PR#83 - 08/01/2026): Integrar VALIDATION_EXCEPTIONS
        # ==========================================================================
        # PROBLEMA ORIGINAL:
        #   - validate_mode não usava is_validation_exception()
        #   - Estruturas multi-UID legítimas eram reportadas como inválidas
        #   - CI/CD pipelines usando --validate falhavam com false positives
        #
        # SOLUÇÃO:
        #   - Usar find_wrong_files_excluding_exceptions() que exclui paths de exceção
        #   - Estruturas multi-UID documentadas são aceitas como válidas
        # ==========================================================================
        
        local wrong_files
        wrong_files=$(find_wrong_files_excluding_exceptions "$path" "$uid" "$gid" 1)
        
        # =======================================================================
        # CORREÇÃO BUG CURSOR REVIEW (PR#77): Sintaxe cross-platform para stat
        # =======================================================================
        # PROBLEMA ORIGINAL:
        #   - validate_mode usava stat -c '%a' (SOMENTE Linux)
        #   - Em macOS, current_perms ficava vazio, causando validação sempre falhar
        #   - Inconsistência com dry_run_mode (que já usava sintaxe cross-platform)
        #
        # SOLUÇÃO:
        #   - Usar mesma sintaxe cross-platform de dry_run_mode e create_mode
        #   - Consistência total entre os 3 modos
        # =======================================================================
        
        # Verificar permissões do diretório pai (cross-platform)
        local current_perms
        current_perms=$(stat -c '%a' "$path" 2>/dev/null || stat -f '%Lp' "$path" 2>/dev/null)
        
        if [[ -n "$wrong_files" ]]; then
            log_error "  ❌ INVÁLIDO: Ownership incorreto detectado em $path"
            log_error "     Primeiro arquivo incorreto: ${wrong_files}"
            
            # Mostrar detalhes do arquivo para debug (cross-platform)
            local file_uid file_gid
            file_uid=$(stat -c '%u' "$wrong_files" 2>/dev/null || stat -f '%u' "$wrong_files" 2>/dev/null || echo "unknown")
            file_gid=$(stat -c '%g' "$wrong_files" 2>/dev/null || stat -f '%g' "$wrong_files" 2>/dev/null || echo "unknown")
            log_error "     UID/GID atual: ${file_uid}:${file_gid}"
            log_error "     UID/GID esperado: ${uid}:${gid}"
            
            ((invalid++))
        elif [[ -z "$current_perms" ]]; then
            log_error "  ❌ INVÁLIDO: Não foi possível determinar permissões de $path (stat falhou)"
            ((invalid++))
        else
            # ==========================================================================
            # CORREÇÃO BUG CRÍTICO (09/01/2026): Detectar bits especiais na validação
            # ==========================================================================
            # PROBLEMA: Comparação direta "2755" != "755" falhava mesmo se
            #           os bits de rwx (últimos 3 dígitos) estivessem corretos
            # SOLUÇÃO: Detectar bits especiais (setuid/setgid/sticky) como inválidos
            # REF: CLAUDE.md Regra 7 (Causa raiz)
            # ==========================================================================
            local current_perms_normalized="${current_perms: -3}"
            local has_special_bits=false
            [[ "${#current_perms}" -gt 3 ]] && has_special_bits=true
            
            if [[ "$current_perms_normalized" != "$perms" ]] || [[ "$has_special_bits" == "true" ]]; then
                log_error "  ❌ INVÁLIDO: Permissões incorretas em $path"
                echo "          Esperado: 0${perms} (sem bits especiais)"
                echo "          Atual:    ${current_perms}"
                if [[ "$has_special_bits" == "true" ]]; then
                    echo "          NOTA: Bits especiais detectados (setuid/setgid/sticky) - devem ser removidos"
                fi
                ((invalid++))
            else
                log_success "  ✅ VÁLIDO: $path (ownership e permissões corretos recursivamente)"
                ((valid++))
            fi
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
        log_error ""
        log_error "💡 SOLUÇÃO: Execute com --create para corrigir automaticamente:"
        log_error "   sudo $0 --create"
        log_error ""
        log_error "⚠️  NOTA: O script agora verifica ownership RECURSIVAMENTE."
        log_error "   Se houver muitos arquivos, a correção pode demorar alguns segundos."
        return 1
    else
        log_success "Validação PASSOU - todos os diretórios estão corretos (verificado recursivamente)"
        return 0
    fi
}

# =============================================================================
# FUNÇÃO: validate_all_directories_have_correct_ownership
# =============================================================================
# Valida que TODOS os diretórios E SEUS CONTEÚDOS têm ownership correto
# Esta validação é executada após create_mode para garantir que não apenas
# os diretórios pai, mas também todos os arquivos e subdiretórios dentro
# deles tenham as permissões corretas (incluindo arquivos de deploys anteriores)
#
# CORREÇÃO BUG #1 (PR#83 - 08/01/2026):
#   PROBLEMA: Loop `echo | while` rodava em subshell, impossibilitando contagem
#             de erros reais vs exceções. `((errors++))` executava incondicionalmente.
#   SOLUÇÃO: Usar array + for loop ao invés de pipe, contar erros reais separadamente.
# =============================================================================
validate_all_directories_have_correct_ownership() {
    log_info "🔍 Validando Ownership Recursivo"
    echo ""
    
    local total_errors=0
    
    for entry in "${DIRECTORIES[@]}"; do
        IFS=':' read -r path uid gid perms <<< "$entry"
        
        if [[ ! -d "$path" ]]; then
            continue  # Diretório não existe, pular
        fi
        
        log_info "Validando $(basename "$path")..."
        
        # =================================================================
        # CORREÇÃO BUG #2 (PR#84 - 08/01/2026): Usar find_wrong_files_excluding_exceptions
        # =================================================================
        # PROBLEMA ANTERIOR: find direto com head -n 5 podia preencher todos os
        #                    slots com arquivos de exceção, ocultando erros REAIS.
        #                    Ex: /logs/ tem 10 arquivos 70:70 (exceção), find retorna
        #                    os primeiros 5, código identifica como exceções, mas
        #                    erros reais em /other/ nunca são vistos.
        #
        # SOLUÇÃO: Usar find_wrong_files_excluding_exceptions() que exclui paths
        #          de exceção diretamente na query find (consistente com outras funções)
        #
        # CONSISTÊNCIA: dry_run_mode, create_mode, validate_mode já usam esta função
        #
        # REF: CLAUDE.md Regra 2 (Não duplicar), Regra 6 (Enterprise-grade)
        # =================================================================
        local wrong_files
        wrong_files=$(find_wrong_files_excluding_exceptions "$path" "$uid" "$gid" "$MAX_WRONG_FILES_DISPLAY")
        
        if [[ -n "$wrong_files" ]]; then
            # =================================================================
            # CORREÇÃO BUG #1: Processar arquivos SEM subshell (usar array)
            # =================================================================
            # PROBLEMA ANTERIOR: `echo | while` criava subshell, variáveis modificadas
            #                    dentro do loop não persistiam fora dele.
            # SOLUÇÃO: Converter output para array e usar for loop regular.
            # =================================================================
            local -a files_array=()
            while IFS= read -r file; do
                [[ -n "$file" ]] && files_array+=("$file")
            done <<< "$wrong_files"
            
            local real_errors=0
            local exceptions_found=0
            local error_details=""
            
            for file in "${files_array[@]}"; do
                # Verificar se é exceção antes de reportar erro
                if is_validation_exception "$file" "$uid" "$gid"; then
                    log_info "    ℹ️  EXCEÇÃO CONHECIDA (multi-UID legítimo): $file"
                    ((exceptions_found++))
                    continue
                fi
                
                # É erro REAL (não é exceção)
                ((real_errors++))
                
                # Otimização: stat uma única vez e captura ambos UID e GID
                local stat_output
                stat_output=$(stat -c '%u:%g' "$file" 2>/dev/null || stat -f '%u:%g' "$file" 2>/dev/null || echo "?:?")
                local file_uid file_gid
                IFS=':' read -r file_uid file_gid <<< "$stat_output"
                error_details+="    ${file} (UID: ${file_uid}, GID: ${file_gid}) - esperado (UID: ${uid}, GID: ${gid})\n"
            done
            
            # SÓ mostrar erro e incrementar contador se houver erros REAIS
            if [[ $real_errors -gt 0 ]]; then
                log_error "  ❌ Arquivos com ownership incorreto em ${path}:"
                echo -e "$error_details" | while read -r line; do
                    [[ -n "$line" ]] && log_warning "$line"
                done
                ((total_errors++))
            elif [[ $exceptions_found -gt 0 ]]; then
                log_success "  ✅ $(basename "$path"): OK (${exceptions_found} exceção(ões) multi-UID legítima(s))"
            fi
        else
            log_success "  ✅ $(basename "$path"): Ownership correto (recursivo)"
        fi
    done
    
    echo ""
    log_info "=========================================="
    if [[ $total_errors -gt 0 ]]; then
        log_error "❌ ${total_errors} diretório(s) com ownership incorreto!"
        log_info "=========================================="
        return 1
    fi
    
    log_success "✅ Todos os diretórios têm ownership correto (recursivo)"
    log_info "=========================================="
    return 0
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
                echo ""
                # Validar que ownership recursivo está correto após create
                if validate_all_directories_have_correct_ownership; then
                    log_success "Operação concluída com sucesso!"
                    exit 0
                else
                    log_error "Validação falhou - alguns arquivos têm ownership incorreto"
                    exit 1
                fi
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
