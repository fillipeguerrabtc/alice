#!/bin/bash
# =============================================================================
# Mixtral 8x7B vLLM - Entrypoint
# =============================================================================

set -e

echo "=== Alice Mixtral 8x7B vLLM ==="
echo "Model: ${MODEL_NAME}"
echo "Quantization: ${QUANTIZATION}"
echo "Max Model Length: ${MAX_MODEL_LEN}"
echo "GPU Memory Utilization: ${GPU_MEMORY_UTILIZATION}"
echo ""

# Verificar GPU
if ! nvidia-smi > /dev/null 2>&1; then
    echo "ERROR: NVIDIA GPU não detectada!"
    exit 1
fi

echo "GPU detectada:"
nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader
echo ""

# Iniciar vLLM server
echo "Iniciando vLLM server..."
exec python3 -m vllm.entrypoints.openai.api_server \
    --model "${MODEL_NAME}" \
    --quantization "${QUANTIZATION}" \
    --max-model-len "${MAX_MODEL_LEN}" \
    --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}" \
    --tensor-parallel-size "${TENSOR_PARALLEL_SIZE}" \
    --host "${HOST}" \
    --port "${PORT}" \
    --trust-remote-code
