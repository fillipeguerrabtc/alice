#!/bin/bash
# =============================================================================
# Qwen2.5 7B (AWQ) - vLLM Entrypoint (LLM texto)
# =============================================================================
# GPU local dedicada: Texto + Embeddings + ASR
# Vision/Geração de imagens: OpenAI API (somente OPENAI_API_KEY) - fora deste container.
#
# Autor: Fillipe Guerra
# Data: 16 de Janeiro de 2026
# =============================================================================

set -e

echo "=== Alice LLM (Qwen2.5 7B Instruct AWQ) ==="
echo "Model: ${MODEL_NAME}"
echo "Quantization: ${QUANTIZATION}"
echo "Max Model Length: ${MAX_MODEL_LEN}"
echo "GPU Memory Utilization: ${GPU_MEMORY_UTILIZATION}"
echo "Max Batched Tokens: ${MAX_NUM_BATCHED_TOKENS:-auto}"
echo "Max Num Seqs: ${MAX_NUM_SEQS:-auto}"
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
  --max-num-batched-tokens "${MAX_NUM_BATCHED_TOKENS:-1536}" \
  --max-num-seqs "${MAX_NUM_SEQS:-16}" \
  --tensor-parallel-size "${TENSOR_PARALLEL_SIZE}" \
  --guided-decoding-backend outlines \
  --host "${HOST}" \
  --port "${PORT}"

