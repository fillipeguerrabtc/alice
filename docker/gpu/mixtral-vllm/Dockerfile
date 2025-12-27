# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - Mixtral 8x7B vLLM
# =============================================================================
# Dockerfile para LLM inference com vLLM em GPU RTX 4000 SFF Ada (20GB)
# Modelo: Mixtral 8x7B Instruct (quantizado AWQ 4-bit)
# 
# BEST PRACTICE 2025: Usar container oficial NVIDIA NGC
# - Container pré-compilado e otimizado pela NVIDIA
# - Inclui vLLM, PyTorch, CUDA com compatibilidade garantida
# - Ref: https://docs.nvidia.com/deeplearning/frameworks/vllm-release-notes/
# 
# Release 25.12 (Dezembro 2025):
# - vLLM: 0.11.1
# - CUDA: 13.1.0.36
# - PyTorch: 2.10.0a0+b4e4ee81d3
# - transformers: 4.57.1
# - flash-attention: 2.7.4.post1
# 
# Autor: Fillipe Guerra
# Data: 27 de Dezembro de 2025
# =============================================================================

# ENTERPRISE 27/12/2025: Container oficial NVIDIA NGC (Best Practice 2025)
# - Todas as dependências pré-compiladas e otimizadas pela NVIDIA
# - Compatibilidade garantida entre vLLM, PyTorch e CUDA
# - Inclui otimizações específicas para GPUs NVIDIA (TensorRT, FlashAttention)
FROM nvcr.io/nvidia/vllm:25.12

LABEL maintainer="Fillipe Guerra"
LABEL description="Mixtral 8x7B vLLM inference server (NVIDIA NGC)"
LABEL version="3.0.0"

ENV PIP_ROOT_USER_ACTION=ignore

WORKDIR /app

# Instalar apenas dependências adicionais para API e métricas
# vLLM, PyTorch, transformers já estão instalados no container NVIDIA
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install \
    fastapi==0.115.6 \
    uvicorn==0.34.0 \
    prometheus-client==0.21.1

# Copiar scripts customizados
COPY healthcheck.py /app/healthcheck.py
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Variáveis de configuração do modelo
# Bug fix: Usar modelo AWQ pré-quantizado (base model não tem weights AWQ)
ENV MODEL_NAME="TheBloke/Mixtral-8x7B-Instruct-v0.1-AWQ"
ENV QUANTIZATION="awq"
ENV MAX_MODEL_LEN="32768"
ENV GPU_MEMORY_UTILIZATION="0.95"
ENV TENSOR_PARALLEL_SIZE="1"
ENV PORT="8000"
ENV HOST="0.0.0.0"

# Expor porta
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

# Entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
