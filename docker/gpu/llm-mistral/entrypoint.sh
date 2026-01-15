#!/bin/bash
# =============================================================================
# Mistral 7B (AWQ) - vLLM Entrypoint (LLM texto)
# =============================================================================
# Gate 2: LLM (texto) separado de VLM (visão)
#
# Autor: Fillipe Guerra
# Data: 15 de Janeiro de 2026
# =============================================================================

set -e

echo "=== Alice LLM (Mistral 7B Instruct AWQ) ==="
echo "Model: ${MODEL_NAME}"
echo "Quantization: ${QUANTIZATION}"
echo "Max Model Length: ${MAX_MODEL_LEN}"
echo "GPU Memory Utilization: ${GPU_MEMORY_UTILIZATION}"
echo "vLLM Version: 0.12.0"
echo ""

if ! nvidia-smi > /dev/null 2>&1; then
  echo "ERROR: NVIDIA GPU não detectada!"
  exit 1
fi

echo "GPU detectada:"
nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader
echo ""

exec python3 -m vllm.entrypoints.openai.api_server \
  --model "${MODEL_NAME}" \
  --quantization "${QUANTIZATION}" \
  --dtype float16 \
  --max-model-len "${MAX_MODEL_LEN}" \
  --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}" \
  --tensor-parallel-size "${TENSOR_PARALLEL_SIZE}" \
  --host "${HOST}" \
  --port "${PORT}"

