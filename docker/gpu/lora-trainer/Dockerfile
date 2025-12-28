# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - LoRA Trainer (GPU)
# =============================================================================
# Serviço GPU para fine-tuning LoRA/QLoRA no servidor Hetzner GEX44 (RTX 4000 Ada 20GB).
# - Objetivo: executar slices curtas de treinamento para permitir preempção (chat > embeddings > training)
# - Persistência: checkpoints/adapters em /opt/alice/uploads/training (bind mount)
#
# ARQUITETURA ENTERPRISE NGC (28/12/2025):
# - Base: nvcr.io/nvidia/pytorch:25.12-py3 (container oficial NVIDIA - PÚBLICO)
# - PyTorch: 2.10.0a0 otimizado pela NVIDIA
# - CUDA: 13.1 com kernels otimizados
# - TensorRT Model Optimizer incluído
# - Transformer Engine incluído (FP8 support para treinamento)
#
# Performance: Otimizações NVIDIA (cuDNN, NCCL, TensorRT)
#
# Ref: https://docs.nvidia.com/deeplearning/frameworks/pytorch-release-notes/rel-25-12.html
#
# Autor: Fillipe Guerra
# Data: 28 de Dezembro de 2025
# =============================================================================

# ENTERPRISE 27/12/2025: Container oficial NVIDIA NGC PyTorch (PÚBLICO)
# - PyTorch otimizado pela NVIDIA com TensorRT, Transformer Engine
# - CUDA 13.0, cuDNN 9, NCCL pré-configurados
# - Sem necessidade de NGC_API_KEY (container público)
FROM nvcr.io/nvidia/pytorch:25.12-py3

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
    huggingface_hub==1.2.3 \
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
