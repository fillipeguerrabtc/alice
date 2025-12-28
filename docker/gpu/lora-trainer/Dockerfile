# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - LoRA Trainer (GPU)
# =============================================================================
# Serviço GPU para fine-tuning LoRA/QLoRA no servidor Hetzner GEX44 (RTX 4000 Ada 20GB).
# - Objetivo: executar slices curtas de treinamento para permitir preempção (chat > embeddings > training)
# - Persistência: checkpoints/adapters em /opt/alice/uploads/training (bind mount)
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
LABEL description="LoRA Trainer GPU (Fine-tuning enterprise) - NVIDIA NGC"
LABEL version="2.1.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_ROOT_USER_ACTION=ignore

RUN apt-get update && apt-get install -y --no-install-recommends git curl \
    && rm -rf /var/lib/apt/lists/*

# SECURITY HARDENING: Criar usuário não-root (Best Practice 2025)
RUN useradd -m -u 1000 trainer
WORKDIR /app

# Dependências de ML - PyTorch JÁ INSTALADO na imagem NGC!
# ENTERPRISE 28/12/2025: Versões mais recentes de todas as dependências
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install \
    transformers==4.57.3 \
    accelerate==1.12.0 \
    datasets==4.0.0 \
    peft==0.18.0 \
    bitsandbytes==0.49.0 \
    safetensors==0.7.0 \
    huggingface_hub==0.36.0 \
    fastapi==0.127.0 \
    uvicorn==0.40.0 \
    pydantic==2.12.5 \
    numpy==2.4.0 \
    prometheus-client==0.23.1

COPY app/ /app/
COPY healthcheck.py /app/healthcheck.py

RUN chown -R trainer:trainer /app
USER trainer

ENV PORT="8000"
ENV DEVICE="cuda"
ENV STORAGE_DIR="/opt/alice/uploads/training"
ENV HF_HOME="/app/.cache/huggingface"
ENV TRANSFORMERS_CACHE="/app/.cache/huggingface/transformers"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
