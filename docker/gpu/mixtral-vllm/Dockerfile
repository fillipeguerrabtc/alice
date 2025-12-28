# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - Mixtral 8x7B vLLM
# =============================================================================
# Dockerfile para LLM inference com vLLM em GPU RTX 4000 SFF Ada (20GB)
# Modelo: Mixtral 8x7B Instruct (quantizado AWQ 4-bit)
# 
# ARQUITETURA ENTERPRISE (27/12/2025):
# - Base: pytorch/pytorch:2.9.1-cuda13.0-cudnn9-runtime (PyTorch + CUDA 13.0)
# - vLLM: 0.13.0 com binários CUDA 13.0 (via GitHub releases)
# - Servidor Hetzner GEX44: Driver NVIDIA 580.95.05 (suporta CUDA 13.0)
# 
# NOTA: NVIDIA NGC (nvcr.io/nvidia/vllm) requer autenticação NGC_API_KEY
# Solução: Usar imagem base PyTorch pública + vLLM wheel CUDA 13.0 do GitHub
# 
# Ref: https://docs.vllm.ai/en/stable/getting_started/installation/gpu/
# 
# Autor: Fillipe Guerra
# Data: 27 de Dezembro de 2025
# =============================================================================

# ENTERPRISE 27/12/2025: Imagem base PyTorch oficial com CUDA 13.0 (pública)
# Consistente com outros serviços GPU (embeddings, flux, lora-trainer)
FROM pytorch/pytorch:2.9.1-cuda13.0-cudnn9-runtime

LABEL maintainer="Fillipe Guerra"
LABEL description="Mixtral 8x7B vLLM inference server"
LABEL version="3.2.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_ROOT_USER_ACTION=ignore

# Instalar dependências do sistema (curl e jq para download do vLLM)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# SECURITY HARDENING: Criar usuário não-root (Best Practice 2025)
# Consistente com outros serviços GPU (embeddings, flux, asr, lora-trainer)
# Ref: CLAUDE.md "51 containers = 100% com security_opt: no-new-privileges"
RUN useradd -m -u 1000 vllm

WORKDIR /app

# Instalar vLLM 0.13.0 com binários CUDA 13.0 do GitHub releases
# NOTA: vLLM compila kernels CUDA específicos - usar versão correta é crítico
# Ref: https://docs.vllm.ai/en/stable/getting_started/installation/gpu/
ENV VLLM_VERSION=0.13.0
ENV CUDA_VERSION=130

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install \
    https://github.com/vllm-project/vllm/releases/download/v${VLLM_VERSION}/vllm-${VLLM_VERSION}+cu${CUDA_VERSION}-cp38-abi3-manylinux_2_31_x86_64.whl \
    --extra-index-url https://download.pytorch.org/whl/cu${CUDA_VERSION}

# Dependências adicionais para API e métricas
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install \
    fastapi==0.115.6 \
    uvicorn==0.34.0 \
    prometheus-client==0.21.1

# Copiar scripts customizados
COPY healthcheck.py /app/healthcheck.py
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Configurar permissões e mudar para usuário não-root
RUN chown -R vllm:vllm /app
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
