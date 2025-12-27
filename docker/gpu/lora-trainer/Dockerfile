# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - LoRA Trainer (GPU)
# =============================================================================
# Serviço GPU para fine-tuning LoRA/QLoRA no servidor Hetzner GEX44 (RTX 4000 Ada 20GB).
# - Objetivo: executar slices curtas de treinamento para permitir preempção (chat > embeddings > training)
# - Persistência: checkpoints/adapters em /opt/alice/uploads/training (bind mount)
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
LABEL description="LoRA Trainer GPU (Fine-tuning enterprise) - Alice Platform"
LABEL version="1.2.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_ROOT_USER_ACTION=ignore

RUN apt-get update && apt-get install -y --no-install-recommends git curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 trainer
WORKDIR /app

# Dependências de ML - PyTorch JÁ INSTALADO na imagem base!
# ENTERPRISE 27/12/2025: Versões mais recentes compatíveis com PyTorch 2.9.1
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install \
    transformers==4.48.0 \
    accelerate==1.3.0 \
    datasets==3.3.0 \
    peft==0.15.0 \
    bitsandbytes==0.46.0 \
    safetensors==0.5.2 \
    huggingface_hub==0.28.1 \
    fastapi==0.115.6 \
    uvicorn==0.34.0 \
    pydantic==2.10.5 \
    numpy==2.2.2 \
    prometheus-client==0.21.1

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
