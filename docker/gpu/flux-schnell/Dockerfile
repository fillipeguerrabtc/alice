# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - FLUX.1 Schnell
# =============================================================================
# Dockerfile para geração de imagens com FLUX.1 Schnell em GPU RTX 4000 SFF Ada (20GB)
# 
# ARQUITETURA DOCKER HUB (28/12/2025):
# - Base: pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel (Docker Hub - 100% PÚBLICO)
# - PyTorch: 2.7.1 com CUDA 12.8 e cuDNN 9
# - SEM AUTENTICAÇÃO NECESSÁRIA - 100% público
# 
# Ref: https://hub.docker.com/r/pytorch/pytorch
# 
# Autor: Fillipe Guerra
# Data: 28 de Dezembro de 2025
# =============================================================================

# ENTERPRISE 28/12/2025: PyTorch oficial Docker Hub (100% PÚBLICO)
# - Sem necessidade de NGC login - imagem pública
# - PyTorch 2.7.1 com CUDA 12.8 e cuDNN 9
FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel

LABEL maintainer="Fillipe Guerra"
LABEL description="FLUX.1 Schnell image generation server (NVIDIA NGC)"
LABEL version="2.1.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_ROOT_USER_ACTION=ignore

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# SECURITY HARDENING: Criar usuário não-root (Best Practice 2025)
RUN useradd -m -u 1000 flux
WORKDIR /app

# Instalar dependências - PyTorch JÁ INSTALADO na imagem NGC!
# ENTERPRISE 28/12/2025: Versões mais recentes de todas as dependências
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install \
    diffusers==0.35.1 \
    transformers==4.57.3 \
    accelerate==1.12.0 \
    safetensors==0.7.0 \
    sentencepiece==0.2.1 \
    fastapi==0.127.0 \
    uvicorn==0.40.0 \
    python-multipart==0.0.21 \
    pillow==12.0.0 \
    prometheus-client==0.23.1

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
