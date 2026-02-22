#!/bin/bash
# =============================================================================
# Qwen2.5 7B (AWQ) - vLLM Entrypoint (LLM texto + LoRA adapters)
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
# Data: 09 de Fevereiro de 2026
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

MAX_MODEL_LEN_RESOLVED="$(resolve_env_value "4096" "MAX_MODEL_LEN" "LLM_MAX_MODEL_LEN")"
MAX_MODEL_LEN_VALUE="${MAX_MODEL_LEN_RESOLVED%%|*}"
MAX_MODEL_LEN_SOURCE="${MAX_MODEL_LEN_RESOLVED#*|}"

MAX_NUM_SEQS_RESOLVED="$(resolve_env_value "8" "MAX_NUM_SEQS" "LLM_MAX_NUM_SEQS")"
MAX_NUM_SEQS_VALUE="${MAX_NUM_SEQS_RESOLVED%%|*}"
MAX_NUM_SEQS_SOURCE="${MAX_NUM_SEQS_RESOLVED#*|}"

MAX_BATCHED_TOKENS_RESOLVED="$(resolve_env_value "1024" "MAX_NUM_BATCHED_TOKENS" "LLM_MAX_NUM_BATCHED_TOKENS")"
MAX_BATCHED_TOKENS_VALUE="${MAX_BATCHED_TOKENS_RESOLVED%%|*}"
MAX_BATCHED_TOKENS_SOURCE="${MAX_BATCHED_TOKENS_RESOLVED#*|}"

GPU_MEMORY_UTILIZATION_RESOLVED="$(resolve_env_value "0.34" "GPU_MEMORY_UTILIZATION" "LLM_GPU_MEMORY_UTILIZATION")"
GPU_MEMORY_UTILIZATION_VALUE="${GPU_MEMORY_UTILIZATION_RESOLVED%%|*}"
GPU_MEMORY_UTILIZATION_SOURCE="${GPU_MEMORY_UTILIZATION_RESOLVED#*|}"

echo "=== Alice LLM (Qwen2.5 7B Instruct AWQ + LoRA) ==="
echo "Model: ${MODEL_NAME}"
echo "Quantization: ${QUANTIZATION}"
echo "Max Model Length: ${MAX_MODEL_LEN_VALUE} (source=${MAX_MODEL_LEN_SOURCE})"
echo "GPU Memory Utilization: ${GPU_MEMORY_UTILIZATION_VALUE} (source=${GPU_MEMORY_UTILIZATION_SOURCE})"
echo "Max Batched Tokens: ${MAX_BATCHED_TOKENS_VALUE} (source=${MAX_BATCHED_TOKENS_SOURCE})"
echo "Max Num Seqs: ${MAX_NUM_SEQS_VALUE} (source=${MAX_NUM_SEQS_SOURCE})"
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
  --tensor-parallel-size "${TENSOR_PARALLEL_SIZE}" \
  --structured-outputs-config '{"backend":"outlines"}' \
  ${LORA_ARGS} \
  --host "${HOST}" \
  --port "${PORT}"
