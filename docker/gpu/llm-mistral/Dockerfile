# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - LLM (Texto) - Mistral 7B Instruct (AWQ)
# =============================================================================
# Objetivo:
# - Servir um LLM **texto-only** para Chat/Trading via OpenAI-compatible API (vLLM)
# - Separado do VLM (visão) conforme Gate 2
#
# Base:
# - vllm/vllm-openai:v0.12.0 (imagem oficial pública)
#
# Modelo:
# - TheBloke/Mistral-7B-Instruct-v0.2-AWQ (AWQ 4-bit)
#
# Autor: Fillipe Guerra
# Data: 15 de Janeiro de 2026
# =============================================================================

FROM vllm/vllm-openai:v0.12.0

LABEL maintainer="Fillipe Guerra"
LABEL description="Mistral 7B Instruct (AWQ) - LLM text-only vLLM inference server"
LABEL version="1.0.0"
LABEL architecture="gate2-llm-separate"

WORKDIR /app

COPY healthcheck.py /app/healthcheck.py
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Configuração do modelo (valores podem ser sobrescritos por env no docker-compose)
ENV MODEL_NAME="TheBloke/Mistral-7B-Instruct-v0.2-AWQ"
ENV QUANTIZATION="awq"
ENV MAX_MODEL_LEN="2048"
ENV GPU_MEMORY_UTILIZATION="0.35"
ENV TENSOR_PARALLEL_SIZE="1"
ENV PORT="8000"
ENV HOST="0.0.0.0"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]

