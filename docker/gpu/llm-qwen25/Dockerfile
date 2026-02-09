# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - LLM (Texto + LoRA) - Qwen2.5 7B Instruct (AWQ)
# =============================================================================
# Objetivo:
# - Servir LLM **texto-only** para Chat/Trading via OpenAI-compatible API (vLLM)
# - Suporte a LoRA adapters dinâmicos para fine-tuning incremental
# - GPU local dedicada apenas para Texto + Embeddings + ASR (Vision via OpenAI)
#
# Base:
# - vllm/vllm-openai:v0.12.0 (imagem oficial pública)
#
# Modelo:
# - Qwen/Qwen2.5-7B-Instruct-AWQ (AWQ 4-bit)
# - LoRA adapters: carregados em runtime via filesystem resolver (~50-100MB extra)
#
# LoRA Architecture:
# - AWQ + LoRA: compatível com vLLM 0.12.0+ (documentação oficial)
# - Dynamic loading: adapters carregados sem restart do container
# - Volume mount: /opt/alice/data/lora-adapters (read-only no container)
# - Impacto VRAM: ~50-100MB por adapter rank-16 (negligível no budget 20GB)
#
# Autor: Fillipe Guerra
# Data: 09 de Fevereiro de 2026
# =============================================================================

FROM vllm/vllm-openai:v0.12.0

LABEL maintainer="Fillipe Guerra"
LABEL description="Qwen2.5 7B Instruct (AWQ + LoRA) - LLM vLLM inference server"
LABEL version="1.1.0"
LABEL architecture="gpu-text-only-openai-vision-lora"

WORKDIR /app

COPY healthcheck.py /app/healthcheck.py
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Configuração do modelo (valores podem ser sobrescritos por env no docker-compose)
ENV MODEL_NAME="Qwen/Qwen2.5-7B-Instruct-AWQ"
# awq_marlin usa kernels Marlin otimizados para AWQ no vLLM 0.12.0+
# Benchmark: awq ~6-7 tok/s → awq_marlin ~20-50+ tok/s (2-4x melhoria)
ENV QUANTIZATION="awq_marlin"
ENV MAX_MODEL_LEN="6144"
ENV GPU_MEMORY_UTILIZATION="0.42"
ENV MAX_NUM_BATCHED_TOKENS="1536"
ENV MAX_NUM_SEQS="16"
ENV TENSOR_PARALLEL_SIZE="1"
ENV PORT="8000"
ENV HOST="0.0.0.0"

# Configuração LoRA (AWQ + LoRA suportado desde vLLM 0.12.0)
# ENABLE_LORA: habilita suporte a LoRA adapters dinâmicos
# MAX_LORA_RANK: rank máximo do adapter (alinhado com QLoRA config que usa rank 16)
# MAX_LORAS: máximo de adapters carregados simultaneamente
# LORA_ADAPTER_DIR: diretório onde adapters são disponibilizados pelo training-service
ENV ENABLE_LORA="true"
ENV MAX_LORA_RANK="16"
ENV MAX_LORAS="2"
ENV LORA_ADAPTER_DIR="/opt/alice/data/lora-adapters"

# vLLM dynamic LoRA loading via filesystem resolver
ENV VLLM_ALLOW_RUNTIME_LORA_UPDATING="true"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]

