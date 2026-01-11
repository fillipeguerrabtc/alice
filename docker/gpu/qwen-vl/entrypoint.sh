#!/bin/bash
# =============================================================================
# Qwen2.5-VL 7B vLLM - Entrypoint
# =============================================================================
# Inicialização do servidor vLLM para modelo multimodal Qwen2.5-VL
#
# ARQUITETURA v4.0.0 (11/01/2026):
# - Modelo multimodal (texto + visão)
# - Quantização AWQ 4-bit (~4GB VRAM)
# - API compatível com OpenAI
#
# Autor: Fillipe Guerra
# Data: 11 de Janeiro de 2026
# =============================================================================

set -e

echo "=== Alice Qwen2.5-VL 7B vLLM ==="
echo "Model: ${MODEL_NAME}"
echo "Quantization: ${QUANTIZATION}"
echo "Max Model Length: ${MAX_MODEL_LEN}"
echo "GPU Memory Utilization: ${GPU_MEMORY_UTILIZATION}"
echo "Architecture: v4.0.0-simplified (multimodal)"
echo ""

# Verificar GPU
if ! nvidia-smi > /dev/null 2>&1; then
    echo "ERROR: NVIDIA GPU não detectada!"
    exit 1
fi

echo "GPU detectada:"
nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader
echo ""

# Iniciar vLLM server com suporte a multimodal
echo "Iniciando vLLM server com suporte a vision..."
exec python3 -m vllm.entrypoints.openai.api_server \
    --model "${MODEL_NAME}" \
    --quantization "${QUANTIZATION}" \
    --max-model-len "${MAX_MODEL_LEN}" \
    --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}" \
    --tensor-parallel-size "${TENSOR_PARALLEL_SIZE}" \
    --host "${HOST}" \
    --port "${PORT}" \
    --trust-remote-code \
    --limit-mm-per-prompt "image=5"
