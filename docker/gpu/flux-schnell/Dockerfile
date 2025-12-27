# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - FLUX.1 Schnell
# =============================================================================
# Dockerfile para geração de imagens com FLUX.1 Schnell em GPU RTX 4000 SFF Ada (20GB)
# 
# OTIMIZAÇÃO BUILD (27/12/2025):
# - Imagem base pytorch/pytorch já tem PyTorch instalado (~3GB economia)
# - BuildKit cache mount para pip (--mount=type=cache)
# 
# Autor: Fillipe Guerra
# Data: 27 de Dezembro de 2025
# =============================================================================

# OTIMIZAÇÃO: Usar imagem oficial PyTorch (PyTorch já instalado!)
# ENTERPRISE 27/12/2025: PyTorch 2.9.1 + CUDA 13.0 (versões mais recentes disponíveis)
# Servidor Hetzner GEX44: Driver NVIDIA 580.95.05 + CUDA 13.0
FROM pytorch/pytorch:2.9.1-cuda13.0-cudnn9-runtime

LABEL maintainer="Fillipe Guerra"
LABEL description="FLUX.1 Schnell image generation server"
LABEL version="1.2.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_ROOT_USER_ACTION=ignore

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 flux
WORKDIR /app

# Instalar dependências - PyTorch JÁ INSTALADO na imagem base!
# ENTERPRISE 27/12/2025: Versões mais recentes compatíveis com PyTorch 2.9.1
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install \
    diffusers==0.33.0 \
    transformers==4.48.0 \
    accelerate==1.3.0 \
    safetensors==0.5.2 \
    sentencepiece==0.2.0 \
    fastapi==0.115.6 \
    uvicorn==0.34.0 \
    python-multipart==0.0.20 \
    pillow==11.1.0 \
    prometheus-client==0.21.1

COPY app/ /app/
COPY healthcheck.py /app/healthcheck.py

RUN chown -R flux:flux /app
USER flux

ENV MODEL_NAME="black-forest-labs/FLUX.1-schnell"
ENV NUM_INFERENCE_STEPS="4"
ENV PORT="8000"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
