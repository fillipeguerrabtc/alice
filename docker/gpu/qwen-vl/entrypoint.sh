#!/bin/bash
# =============================================================================
# Qwen2.5-VL 7B vLLM - Entrypoint
# =============================================================================
# Inicialização do servidor vLLM para modelo multimodal Qwen2.5-VL
#
# ARQUITETURA v4.0.0 (12/01/2026):
# - Modelo multimodal (texto + visão)
# - Quantização AWQ 4-bit (~4GB VRAM)
# - API compatível com OpenAI
# - vLLM v0.12.0 com correções de sintaxe
#
# CORREÇÕES vLLM v0.12.0:
# - --limit-mm-per-prompt: formato JSON obrigatório (antes: key=value)
# - --dtype float16: obrigatório para AWQ (bfloat16 não suportado)
#
# Autor: Fillipe Guerra
# Data: 12 de Janeiro de 2026
# =============================================================================

set -e

echo "=== Alice Qwen2.5-VL 7B vLLM ==="
echo "Model: ${MODEL_NAME}"
echo "Quantization: ${QUANTIZATION}"
echo "Max Model Length: ${MAX_MODEL_LEN}"
echo "GPU Memory Utilization: ${GPU_MEMORY_UTILIZATION}"
echo "Architecture: v4.1.0-official-fix (multimodal)"
echo "vLLM Version: 0.12.0"
echo ""
echo "CORREÇÃO OFICIAL 2025: Usando --skip-mm-profiling"
echo "Bug conhecido: PyTorch calcula memória incorretamente em profile_run"
echo "Ref: https://katielovesdogs.com/blog/vllm-memory-bug-with-qwen"
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
# CORREÇÕES OFICIAIS 2025:
# 1. --skip-mm-profiling: FIX CRÍTICO - pula profiling bugado (Doc Oficial 2025)
# 2. --dtype float16: OBRIGATÓRIO para AWQ (AWQ não suporta bfloat16)
# 3. --limit-mm-per-prompt: JSON obrigatório vLLM 0.12.0+
# 4. --trust-remote-code: Necessário para Qwen2.5-VL
# 
# Ref: https://qwen.readthedocs.io/en/v2.5/deployment/vllm.html
# Ref: https://katielovesdogs.com/blog/vllm-memory-bug-with-qwen
exec python3 -m vllm.entrypoints.openai.api_server \
    --model "${MODEL_NAME}" \
    --quantization "${QUANTIZATION}" \
    --dtype float16 \
    --max-model-len "${MAX_MODEL_LEN}" \
    --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}" \
    --tensor-parallel-size "${TENSOR_PARALLEL_SIZE}" \
    --host "${HOST}" \
    --port "${PORT}" \
    --trust-remote-code \
    --skip-mm-profiling \
    --limit-mm-per-prompt '{"image": 5}'
