# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - Mixtral 8x7B vLLM
# =============================================================================
# Dockerfile para LLM inference com vLLM em GPU RTX 4000 SFF Ada (20GB)
# Modelo: Mixtral 8x7B Instruct (quantizado AWQ 4-bit)
# 
# NOTA: vLLM requer imagem CUDA devel (headers de compilação)
# Não pode usar pytorch/pytorch como base
# 
# OTIMIZAÇÃO BUILD (27/12/2025):
# - BuildKit cache mount para pip (--mount=type=cache)
# - vLLM instalado primeiro (mais pesado, melhor cache)
# 
# Autor: Fillipe Guerra
# Data: 27 de Dezembro de 2025
# =============================================================================

FROM nvidia/cuda:12.1.1-devel-ubuntu22.04

LABEL maintainer="Fillipe Guerra"
LABEL description="Mixtral 8x7B vLLM inference server"
LABEL version="1.2.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV CUDA_HOME=/usr/local/cuda
ENV PATH="${CUDA_HOME}/bin:${PATH}"
ENV LD_LIBRARY_PATH="${CUDA_HOME}/lib64:${LD_LIBRARY_PATH}"
ENV PIP_ROOT_USER_ACTION=ignore

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    git \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 vllm
WORKDIR /app

# Instalar vLLM e dependências - BuildKit cache para pip
# vLLM é MUITO pesado (~2GB), instalado primeiro para melhor cache
RUN --mount=type=cache,target=/root/.cache/pip \
    pip3 install --upgrade pip && \
    pip3 install vllm==0.6.4.post1

# Dependências adicionais em layer separado
RUN --mount=type=cache,target=/root/.cache/pip \
    pip3 install \
    torch==2.5.1 \
    transformers==4.47.1 \
    accelerate==1.2.1 \
    safetensors==0.4.5 \
    huggingface_hub==0.27.0 \
    fastapi==0.115.6 \
    uvicorn==0.34.0 \
    prometheus-client==0.21.1

# Copiar script de healthcheck
COPY healthcheck.py /app/healthcheck.py
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Configurar permissões
RUN chown -R vllm:vllm /app

# Mudar para usuário não-root (container roda como não-root)
USER vllm

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
