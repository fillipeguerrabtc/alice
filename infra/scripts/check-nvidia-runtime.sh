#!/bin/bash
# =============================================================================
# Validacao Operacional do Runtime NVIDIA/CDI - Alice Enterprise Platform
# =============================================================================
# Autor: Fillipe Guerra
# Data: 21 de Marco de 2026
#
# PROPOSITO:
#   Validar o estado real do driver NVIDIA, do runtime Docker e dos specs CDI
#   antes de qualquer operacao que dependa de containers GPU.
#
# COMPORTAMENTO:
#   - Falha rapidamente quando encontra drift entre driver e spec CDI
#   - Trata /var/run/cdi/nvidia.yaml como spec gerado e esperado
#   - Opcionalmente reconfigura o runtime Docker via nvidia-ctk
#   - Opcionalmente reconcilia o spec legado persistente em /etc/cdi
# =============================================================================

set -euo pipefail

CONFIGURE_DOCKER_RUNTIME=false
REFRESH_CDI_SPEC=false
RECONCILE_LEGACY_ETC_CDI=false
SKIP_DOCKER_GPU_TEST=false
VERBOSE=false

GPU_TEST_IMAGE="${GPU_TEST_IMAGE:-nvidia/cuda:12.0.0-base-ubuntu22.04}"
RUNTIME_SPEC_PATH="/var/run/cdi/nvidia.yaml"
LEGACY_SPEC_PATH="/etc/cdi/nvidia.yaml"
DISABLED_SPEC_PATH="/etc/cdi/nvidia.yaml.disabled-by-alice"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
    cat <<'EOF'
Uso: check-nvidia-runtime.sh [opcoes]

Opcoes:
  --configure-docker-runtime  Reconfigura o Docker via nvidia-ctk runtime configure.
  --refresh-cdi               Forca refresh do spec CDI esperado em /var/run/cdi/nvidia.yaml.
  --reconcile-legacy-cdi      Desativa explicitamente /etc/cdi/nvidia.yaml e preserva copia.
  --skip-docker-gpu-test      Pula o teste docker run --gpus all.
  --verbose                   Imprime diagnostico adicional.
  --help                      Mostra esta ajuda.
EOF
}

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_fail() { echo -e "${RED}[ERRO]${NC} $1"; exit 1; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --configure-docker-runtime)
            CONFIGURE_DOCKER_RUNTIME=true
            shift
            ;;
        --refresh-cdi)
            REFRESH_CDI_SPEC=true
            shift
            ;;
        --reconcile-legacy-cdi)
            RECONCILE_LEGACY_ETC_CDI=true
            shift
            ;;
        --skip-docker-gpu-test)
            SKIP_DOCKER_GPU_TEST=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            usage
            log_fail "Opcao invalida: $1"
            ;;
    esac
done

require_command() {
    local command_name="$1"

    if ! command -v "$command_name" >/dev/null 2>&1; then
        log_fail "Comando obrigatorio ausente: $command_name"
    fi
}

has_systemd_unit() {
    local unit_name="$1"
    systemctl cat "$unit_name" >/dev/null 2>&1
}

extract_driver_version() {
    nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -n1 | tr -d '[:space:]'
}

extract_spec_versions() {
    local spec_path="$1"
    local matches

    if [[ ! -f "$spec_path" ]]; then
        return 0
    fi

    matches="$(grep -oE 'lib[^"[:space:]]*_nvidia\.so\.[0-9.]+' "$spec_path" || true)"

    if [[ -z "$matches" ]]; then
        return 0
    fi

    printf '%s\n' "$matches" \
        | sed -E 's#.*\.so\.##' \
        | sort -u \
        | paste -sd ',' -
}

spec_references_driver_version() {
    local spec_path="$1"
    local driver_version="$2"
    local escaped_driver_version

    escaped_driver_version=$(printf '%s' "$driver_version" | sed 's/\./\\./g')
    grep -qE "lib[^\"[:space:]]*_nvidia\\.so\\.${escaped_driver_version}" "$spec_path"
}

configure_docker_runtime() {
    require_command nvidia-ctk
    require_command systemctl

    log_info "Configurando runtime Docker via nvidia-ctk..."
    nvidia-ctk runtime configure --runtime=docker >/tmp/alice-nvidia-ctk-runtime.log 2>&1
    systemctl restart docker
    log_ok "Docker configurado com runtime NVIDIA via nvidia-ctk"

    if [[ "$VERBOSE" == true ]]; then
        log_info "Saida do nvidia-ctk runtime configure:"
        sed -n '1,120p' /tmp/alice-nvidia-ctk-runtime.log
    fi
}

refresh_cdi_spec() {
    require_command nvidia-ctk

    mkdir -p /etc/cdi /var/run/cdi

    if has_systemd_unit nvidia-cdi-refresh.path; then
        log_info "Habilitando nvidia-cdi-refresh.path..."
        systemctl enable --now nvidia-cdi-refresh.path >/dev/null 2>&1 || true
    fi

    if has_systemd_unit nvidia-cdi-refresh.service; then
        log_info "Atualizando spec CDI via nvidia-cdi-refresh.service..."
        systemctl restart nvidia-cdi-refresh.service
    else
        log_warn "nvidia-cdi-refresh.service nao encontrado; gerando spec CDI manualmente via nvidia-ctk"
        nvidia-ctk cdi generate --output="$RUNTIME_SPEC_PATH" >/tmp/alice-nvidia-ctk-cdi-generate.log 2>&1
        if [[ "$VERBOSE" == true ]]; then
            log_info "Saida do nvidia-ctk cdi generate:"
            sed -n '1,120p' /tmp/alice-nvidia-ctk-cdi-generate.log
        fi
    fi
}

reconcile_legacy_etc_cdi() {
    if [[ ! -e "$LEGACY_SPEC_PATH" ]]; then
        log_info "Nenhum spec legado ativo encontrado em $LEGACY_SPEC_PATH"
        return 0
    fi

    mkdir -p "$(dirname "$DISABLED_SPEC_PATH")"
    install -m 0644 "$LEGACY_SPEC_PATH" "$DISABLED_SPEC_PATH"
    rm -f "$LEGACY_SPEC_PATH"
    log_warn "Spec legado em $LEGACY_SPEC_PATH foi desativado; copia preservada em $DISABLED_SPEC_PATH"
}

validate_driver_and_docker() {
    require_command nvidia-smi
    require_command docker
    require_command systemctl

    local driver_version
    driver_version="$(extract_driver_version)"

    if [[ -z "$driver_version" ]]; then
        log_fail "Nao foi possivel determinar a versao do driver NVIDIA via nvidia-smi"
    fi

    log_ok "Driver NVIDIA detectado: $driver_version"

    if ! docker info >/dev/null 2>&1; then
        log_fail "Docker nao responde localmente"
    fi
}

validate_docker_runtime_registration() {
    if ! docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q '"nvidia"'; then
        log_fail "Runtime NVIDIA nao aparece em docker info. Reconfigure com nvidia-ctk runtime configure --runtime=docker"
    fi

    log_ok "Docker expoe o runtime NVIDIA"
}

validate_cdi_specs() {
    local driver_version="$1"
    local runtime_versions
    local legacy_versions

    if [[ ! -f "$RUNTIME_SPEC_PATH" ]]; then
        log_fail "Spec CDI esperado ausente em $RUNTIME_SPEC_PATH. Verifique nvidia-cdi-refresh.service"
    fi

    runtime_versions="$(extract_spec_versions "$RUNTIME_SPEC_PATH")"
    legacy_versions="$(extract_spec_versions "$LEGACY_SPEC_PATH")"

    if ! spec_references_driver_version "$RUNTIME_SPEC_PATH" "$driver_version"; then
        log_fail "Spec CDI em $RUNTIME_SPEC_PATH nao referencia o driver atual $driver_version. Versoes encontradas: ${runtime_versions:-nenhuma}"
    fi

    log_ok "Spec CDI gerado em $RUNTIME_SPEC_PATH esta alinhado ao driver $driver_version"

    if [[ -f "$LEGACY_SPEC_PATH" ]]; then
        if cmp -s "$LEGACY_SPEC_PATH" "$RUNTIME_SPEC_PATH"; then
            log_warn "Existe spec persistente redundante em $LEGACY_SPEC_PATH. Ele ainda coincide com /var/run/cdi, mas pode voltar a derivar em um patch ou reboot futuro"
        else
            log_fail "Drift CDI detectado: $LEGACY_SPEC_PATH difere de $RUNTIME_SPEC_PATH. Driver atual: $driver_version. /etc/cdi: ${legacy_versions:-nenhuma}; /var/run/cdi: ${runtime_versions:-nenhuma}. Corrija o spec legado persistente antes de subir containers GPU"
        fi
    else
        log_ok "Nenhum spec legado ativo em $LEGACY_SPEC_PATH"
    fi

    if [[ "$VERBOSE" == true ]] && command -v nvidia-ctk >/dev/null 2>&1; then
        log_info "Saida de nvidia-ctk --debug cdi list:"
        nvidia-ctk --debug cdi list || true
    fi
}

validate_docker_gpu_access() {
    if [[ "$SKIP_DOCKER_GPU_TEST" == true ]]; then
        log_info "Teste docker run --gpus all pulado por opcao explicita"
        return 0
    fi

    log_info "Validando acesso Docker a GPU com $GPU_TEST_IMAGE..."

    if ! docker image inspect "$GPU_TEST_IMAGE" >/dev/null 2>&1; then
        log_info "Imagem de teste GPU ausente; executando pull..."
        docker pull "$GPU_TEST_IMAGE" >/tmp/alice-nvidia-gpu-image-pull.log 2>&1 || {
            if [[ -f /tmp/alice-nvidia-gpu-image-pull.log ]]; then
                sed -n '1,120p' /tmp/alice-nvidia-gpu-image-pull.log
            fi
            log_fail "Falha ao baixar imagem de teste GPU $GPU_TEST_IMAGE"
        }
    fi

    local gpu_test_output
    if ! gpu_test_output=$(docker run --rm --gpus all "$GPU_TEST_IMAGE" nvidia-smi 2>&1); then
        log_fail "Docker nao conseguiu acessar a GPU. Detalhe: $gpu_test_output"
    fi

    log_ok "Docker executa workloads com GPU sem erro de runtime"
}

main() {
    local driver_version

    validate_driver_and_docker

    if [[ "$CONFIGURE_DOCKER_RUNTIME" == true ]]; then
        configure_docker_runtime
    fi

    validate_docker_runtime_registration

    if [[ "$REFRESH_CDI_SPEC" == true ]]; then
        refresh_cdi_spec
    fi

    driver_version="$(extract_driver_version)"
    validate_cdi_specs "$driver_version"

    if [[ "$RECONCILE_LEGACY_ETC_CDI" == true ]]; then
        reconcile_legacy_etc_cdi
        validate_cdi_specs "$driver_version"
    fi

    validate_docker_gpu_access
}

main "$@"
