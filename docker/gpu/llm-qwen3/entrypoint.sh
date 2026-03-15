#!/bin/bash
# =============================================================================
# Qwen3 8B (AWQ) - vLLM Entrypoint (LLM texto + LoRA adapters)
# =============================================================================
# GPU local dedicada: Texto + Embeddings + ASR
# Vision/Geração de imagens: OpenAI API (somente OPENAI_API_KEY) - fora deste container.
#
# LoRA Dynamic Loading:
# - Adapters são carregados em runtime via vLLM filesystem resolver
# - Diretório de adapters: /opt/alice/data/lora-adapters/
# - Ativação automática após aprovação de training job
# - AWQ + LoRA: compatível com vLLM 0.12.0+ (documentação oficial)
# - Impacto VRAM: ~50-100MB por adapter rank-16 (negligível no budget 20GB)
#
# Autor: Fillipe Guerra
# Data: 11 de Marco de 2026
# =============================================================================

set -e

resolve_env_value() {
  local default_value="$1"
  shift
  local resolved_value=""
  local source_name="default"

  for env_name in "$@"; do
    local current_value="${!env_name:-}"
    if [ -n "$current_value" ]; then
      resolved_value="$current_value"
      source_name="$env_name"
      break
    fi
  done

  if [ -z "$resolved_value" ]; then
    resolved_value="$default_value"
  fi

  printf '%s|%s\n' "$resolved_value" "$source_name"
}

validate_integer_env() {
  local env_key="$1"
  local env_value="$2"
  local min_value="$3"
  if ! [[ "$env_value" =~ ^[0-9]+$ ]]; then
    echo "ERROR: ${env_key} deve ser inteiro não-negativo (valor atual: ${env_value})"
    exit 1
  fi
  if ! awk "BEGIN { exit !(${env_value} >= ${min_value}) }"; then
    echo "ERROR: ${env_key} deve ser >= ${min_value} (valor atual: ${env_value})"
    exit 1
  fi
}

validate_float_range_env() {
  local env_key="$1"
  local env_value="$2"
  local min_value="$3"
  local max_value="$4"
  if ! [[ "$env_value" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    echo "ERROR: ${env_key} deve ser número decimal válido (valor atual: ${env_value})"
    exit 1
  fi
  if ! awk "BEGIN { exit !(${env_value} >= ${min_value} && ${env_value} <= ${max_value}) }"; then
    echo "ERROR: ${env_key} deve estar entre ${min_value} e ${max_value} (valor atual: ${env_value})"
    exit 1
  fi
}

warn_if_legacy_source() {
  local source_name="$1"
  local namespaced_env="$2"
  local legacy_env="$3"
  if [ "$source_name" = "$legacy_env" ]; then
    echo "WARN: ${legacy_env} está deprecado; use ${namespaced_env}."
  fi
}

MAX_MODEL_LEN_RESOLVED="$(resolve_env_value "4096" "LLM_MAX_MODEL_LEN" "MAX_MODEL_LEN")"
MAX_MODEL_LEN_VALUE="${MAX_MODEL_LEN_RESOLVED%%|*}"
MAX_MODEL_LEN_SOURCE="${MAX_MODEL_LEN_RESOLVED#*|}"

MAX_NUM_SEQS_RESOLVED="$(resolve_env_value "8" "LLM_MAX_NUM_SEQS" "MAX_NUM_SEQS")"
MAX_NUM_SEQS_VALUE="${MAX_NUM_SEQS_RESOLVED%%|*}"
MAX_NUM_SEQS_SOURCE="${MAX_NUM_SEQS_RESOLVED#*|}"

MAX_BATCHED_TOKENS_RESOLVED="$(resolve_env_value "1024" "LLM_MAX_NUM_BATCHED_TOKENS" "MAX_NUM_BATCHED_TOKENS")"
MAX_BATCHED_TOKENS_VALUE="${MAX_BATCHED_TOKENS_RESOLVED%%|*}"
MAX_BATCHED_TOKENS_SOURCE="${MAX_BATCHED_TOKENS_RESOLVED#*|}"

GPU_MEMORY_UTILIZATION_RESOLVED="$(resolve_env_value "0.36" "LLM_GPU_MEMORY_UTILIZATION" "GPU_MEMORY_UTILIZATION")"
GPU_MEMORY_UTILIZATION_VALUE="${GPU_MEMORY_UTILIZATION_RESOLVED%%|*}"
GPU_MEMORY_UTILIZATION_SOURCE="${GPU_MEMORY_UTILIZATION_RESOLVED#*|}"

KV_CACHE_DTYPE_RESOLVED="$(resolve_env_value "auto" "LLM_KV_CACHE_DTYPE" "KV_CACHE_DTYPE")"
KV_CACHE_DTYPE_VALUE="${KV_CACHE_DTYPE_RESOLVED%%|*}"
KV_CACHE_DTYPE_SOURCE="${KV_CACHE_DTYPE_RESOLVED#*|}"

KV_OFFLOADING_SIZE_GB_RESOLVED="$(resolve_env_value "0" "LLM_KV_OFFLOADING_SIZE_GB" "KV_OFFLOADING_SIZE_GB")"
KV_OFFLOADING_SIZE_GB_VALUE="${KV_OFFLOADING_SIZE_GB_RESOLVED%%|*}"
KV_OFFLOADING_SIZE_GB_SOURCE="${KV_OFFLOADING_SIZE_GB_RESOLVED#*|}"

KV_OFFLOADING_BACKEND_RESOLVED="$(resolve_env_value "cpu" "LLM_KV_OFFLOADING_BACKEND" "KV_OFFLOADING_BACKEND")"
KV_OFFLOADING_BACKEND_VALUE="${KV_OFFLOADING_BACKEND_RESOLVED%%|*}"
KV_OFFLOADING_BACKEND_SOURCE="${KV_OFFLOADING_BACKEND_RESOLVED#*|}"

PREFIX_CACHING_RESOLVED="$(resolve_env_value "true" "LLM_ENABLE_PREFIX_CACHING" "ENABLE_PREFIX_CACHING")"
PREFIX_CACHING_VALUE="${PREFIX_CACHING_RESOLVED%%|*}"
PREFIX_CACHING_SOURCE="${PREFIX_CACHING_RESOLVED#*|}"

TRUST_REMOTE_CODE_RESOLVED="$(resolve_env_value "true" "LLM_TRUST_REMOTE_CODE" "TRUST_REMOTE_CODE")"
TRUST_REMOTE_CODE_VALUE="${TRUST_REMOTE_CODE_RESOLVED%%|*}"
TRUST_REMOTE_CODE_SOURCE="${TRUST_REMOTE_CODE_RESOLVED#*|}"

validate_integer_env "MAX_MODEL_LEN/LLM_MAX_MODEL_LEN" "${MAX_MODEL_LEN_VALUE}" "1"
validate_integer_env "MAX_NUM_SEQS/LLM_MAX_NUM_SEQS" "${MAX_NUM_SEQS_VALUE}" "1"
validate_integer_env "MAX_NUM_BATCHED_TOKENS/LLM_MAX_NUM_BATCHED_TOKENS" "${MAX_BATCHED_TOKENS_VALUE}" "1"
validate_float_range_env "GPU_MEMORY_UTILIZATION/LLM_GPU_MEMORY_UTILIZATION" "${GPU_MEMORY_UTILIZATION_VALUE}" "0.1" "1.0"
validate_float_range_env "KV_OFFLOADING_SIZE_GB/LLM_KV_OFFLOADING_SIZE_GB" "${KV_OFFLOADING_SIZE_GB_VALUE}" "0" "64"

if [ "${KV_CACHE_DTYPE_VALUE}" != "fp8" ] && [ "${KV_CACHE_DTYPE_VALUE}" != "auto" ]; then
  echo "ERROR: KV_CACHE_DTYPE/LLM_KV_CACHE_DTYPE deve ser fp8 ou auto (valor atual: ${KV_CACHE_DTYPE_VALUE})"
  exit 1
fi

if [ "${KV_OFFLOADING_BACKEND_VALUE}" != "cpu" ]; then
  echo "ERROR: KV_OFFLOADING_BACKEND/LLM_KV_OFFLOADING_BACKEND deve ser cpu (valor atual: ${KV_OFFLOADING_BACKEND_VALUE})"
  exit 1
fi

if [ "${PREFIX_CACHING_VALUE}" != "true" ] && [ "${PREFIX_CACHING_VALUE}" != "false" ]; then
  echo "ERROR: ENABLE_PREFIX_CACHING/LLM_ENABLE_PREFIX_CACHING deve ser true ou false (valor atual: ${PREFIX_CACHING_VALUE})"
  exit 1
fi

if [ "${TRUST_REMOTE_CODE_VALUE}" != "true" ] && [ "${TRUST_REMOTE_CODE_VALUE}" != "false" ]; then
  echo "ERROR: TRUST_REMOTE_CODE/LLM_TRUST_REMOTE_CODE deve ser true ou false (valor atual: ${TRUST_REMOTE_CODE_VALUE})"
  exit 1
fi

warn_if_legacy_source "${MAX_MODEL_LEN_SOURCE}" "LLM_MAX_MODEL_LEN" "MAX_MODEL_LEN"
warn_if_legacy_source "${MAX_NUM_SEQS_SOURCE}" "LLM_MAX_NUM_SEQS" "MAX_NUM_SEQS"
warn_if_legacy_source "${MAX_BATCHED_TOKENS_SOURCE}" "LLM_MAX_NUM_BATCHED_TOKENS" "MAX_NUM_BATCHED_TOKENS"
warn_if_legacy_source "${GPU_MEMORY_UTILIZATION_SOURCE}" "LLM_GPU_MEMORY_UTILIZATION" "GPU_MEMORY_UTILIZATION"
warn_if_legacy_source "${KV_CACHE_DTYPE_SOURCE}" "LLM_KV_CACHE_DTYPE" "KV_CACHE_DTYPE"
warn_if_legacy_source "${KV_OFFLOADING_SIZE_GB_SOURCE}" "LLM_KV_OFFLOADING_SIZE_GB" "KV_OFFLOADING_SIZE_GB"
warn_if_legacy_source "${KV_OFFLOADING_BACKEND_SOURCE}" "LLM_KV_OFFLOADING_BACKEND" "KV_OFFLOADING_BACKEND"
warn_if_legacy_source "${PREFIX_CACHING_SOURCE}" "LLM_ENABLE_PREFIX_CACHING" "ENABLE_PREFIX_CACHING"
warn_if_legacy_source "${TRUST_REMOTE_CODE_SOURCE}" "LLM_TRUST_REMOTE_CODE" "TRUST_REMOTE_CODE"

KV_OFFLOADING_ARGS=""
if awk "BEGIN { exit !(${KV_OFFLOADING_SIZE_GB_VALUE} > 0) }"; then
  KV_OFFLOADING_ARGS="--kv-offloading-size ${KV_OFFLOADING_SIZE_GB_VALUE} --kv-offloading-backend ${KV_OFFLOADING_BACKEND_VALUE}"
fi

PREFIX_CACHING_ARGS=""
if [ "${PREFIX_CACHING_VALUE}" = "true" ]; then
  PREFIX_CACHING_ARGS="--enable-prefix-caching"
fi

TRUST_REMOTE_CODE_ARGS=""
if [ "${TRUST_REMOTE_CODE_VALUE}" = "true" ]; then
  # Qwen3 usa chat template/metadata do modelo para controlar reasoning por request
  # (chat_template_kwargs.enable_thinking). Este flag mantém compatibilidade.
  TRUST_REMOTE_CODE_ARGS="--trust-remote-code"
fi

echo "=== Alice LLM (Qwen3 8B AWQ + LoRA) ==="
echo "Model: ${MODEL_NAME}"
echo "Quantization: ${QUANTIZATION}"
echo "Max Model Length: ${MAX_MODEL_LEN_VALUE} (source=${MAX_MODEL_LEN_SOURCE})"
echo "GPU Memory Utilization: ${GPU_MEMORY_UTILIZATION_VALUE} (source=${GPU_MEMORY_UTILIZATION_SOURCE})"
echo "Max Batched Tokens: ${MAX_BATCHED_TOKENS_VALUE} (source=${MAX_BATCHED_TOKENS_SOURCE})"
echo "Max Num Seqs: ${MAX_NUM_SEQS_VALUE} (source=${MAX_NUM_SEQS_SOURCE})"
echo "KV Cache DType: ${KV_CACHE_DTYPE_VALUE} (source=${KV_CACHE_DTYPE_SOURCE})"
echo "KV Offloading Size (GB): ${KV_OFFLOADING_SIZE_GB_VALUE} (source=${KV_OFFLOADING_SIZE_GB_SOURCE})"
echo "KV Offloading Backend: ${KV_OFFLOADING_BACKEND_VALUE} (source=${KV_OFFLOADING_BACKEND_SOURCE})"
echo "Prefix Caching: ${PREFIX_CACHING_VALUE} (source=${PREFIX_CACHING_SOURCE})"
echo "Trust Remote Code: ${TRUST_REMOTE_CODE_VALUE} (source=${TRUST_REMOTE_CODE_SOURCE})"
echo "LoRA Enabled: ${ENABLE_LORA:-true}"
echo "Max LoRA Rank: ${MAX_LORA_RANK:-16}"
echo "Max LoRAs: ${MAX_LORAS:-2}"
echo "LoRA Adapter Dir: ${LORA_ADAPTER_DIR:-/opt/alice/data/lora-adapters}"
echo "vLLM Version: 0.12.0"
echo ""

if ! nvidia-smi > /dev/null 2>&1; then
  echo "ERROR: NVIDIA GPU não detectada!"
  exit 1
fi

echo "GPU detectada:"
nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader
echo ""

# Verificar se existem adapters LoRA disponíveis
LORA_DIR="${LORA_ADAPTER_DIR:-/opt/alice/data/lora-adapters}"
if [ -d "$LORA_DIR" ]; then
  ADAPTER_COUNT=$(find "$LORA_DIR" -name "adapter_config.json" -type f 2>/dev/null | wc -l)
  echo "LoRA adapters encontrados: ${ADAPTER_COUNT}"
  if [ "$ADAPTER_COUNT" -gt 0 ]; then
    find "$LORA_DIR" -name "adapter_config.json" -type f 2>/dev/null | while read -r cfg; do
      echo "  - $(dirname "$cfg")"
    done
  fi
else
  echo "Diretório LoRA não encontrado: ${LORA_DIR} (será criado pelo deploy)"
fi
echo ""

# Montar argumentos LoRA condicionalmente
LORA_ARGS=""
if [ "${ENABLE_LORA:-true}" = "true" ]; then
  LORA_ARGS="--enable-lora --max-lora-rank ${MAX_LORA_RANK:-16} --max-loras ${MAX_LORAS:-2}"
  echo "LoRA habilitado com rank máximo ${MAX_LORA_RANK:-16} e ${MAX_LORAS:-2} adapters simultâneos"
else
  echo "LoRA desabilitado (ENABLE_LORA=false)"
fi

exec python3 -m vllm.entrypoints.openai.api_server \
  --model "${MODEL_NAME}" \
  --quantization "${QUANTIZATION}" \
  --dtype float16 \
  --max-model-len "${MAX_MODEL_LEN_VALUE}" \
  --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION_VALUE}" \
  --max-num-batched-tokens "${MAX_BATCHED_TOKENS_VALUE}" \
  --max-num-seqs "${MAX_NUM_SEQS_VALUE}" \
  --kv-cache-dtype "${KV_CACHE_DTYPE_VALUE}" \
  --tensor-parallel-size "${TENSOR_PARALLEL_SIZE}" \
  --structured-outputs-config '{"backend":"outlines"}' \
  ${TRUST_REMOTE_CODE_ARGS} \
  ${PREFIX_CACHING_ARGS} \
  ${LORA_ARGS} \
  ${KV_OFFLOADING_ARGS} \
  --host "${HOST}" \
  --port "${PORT}"
