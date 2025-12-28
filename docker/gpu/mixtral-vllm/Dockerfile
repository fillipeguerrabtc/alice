# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - Mixtral 8x7B vLLM
# =============================================================================
# Dockerfile para LLM inference com vLLM em GPU RTX 4000 SFF Ada (20GB)
# Modelo: Mixtral 8x7B Instruct (quantizado AWQ 4-bit)
# 
# ARQUITETURA ENTERPRISE (27/12/2025):
# - Base: pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime (PyTorch + CUDA 12.8)
# - vLLM: 0.13.0 via pip (binários padrão são CUDA 12.8)
# - Servidor Hetzner GEX44: Driver NVIDIA 580.95.05 (backward compatible)
# 
# NOTA: vLLM só publica wheels para CUDA 12.8 e 12.6 (não 13.0)
# Driver NVIDIA 580+ é backward compatible com CUDA 12.8
# 
# Ref: https://docs.vllm.ai/en/stable/getting_started/installation/gpu/
# 
# Autor: Fillipe Guerra
# Data: 27 de Dezembro de 2025
# =============================================================================

# ENTERPRISE 27/12/2025: Imagem base PyTorch oficial com CUDA 12.8 (pública)
# vLLM publica binários apenas para CUDA 12.8/12.6 - não existe cu130
# Driver NVIDIA 580 é backward compatible com CUDA 12.8
FROM pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime

LABEL maintainer="Fillipe Guerra"
LABEL description="Mixtral 8x7B vLLM inference server"
LABEL version="3.3.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_ROOT_USER_ACTION=ignore

# SECURITY HARDENING: Criar usuário não-root (Best Practice 2025)
# Consistente com outros serviços GPU (embeddings, flux, asr, lora-trainer)
# Ref: CLAUDE.md "51 containers = 100% com security_opt: no-new-privileges"
RUN useradd -m -u 1000 vllm

WORKDIR /app

# Instalar vLLM 0.13.0 via pip (binários padrão são CUDA 12.8)
# Ref: https://docs.vllm.ai/en/stable/getting_started/installation/gpu/
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install vllm==0.13.0 --extra-index-url https://download.pytorch.org/whl/cu128

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
