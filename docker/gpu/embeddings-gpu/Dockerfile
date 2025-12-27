# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - Embeddings GPU (Arquitetura Unificada)
# =============================================================================
# Dockerfile para embeddings enterprise:
# - Texto: Qwen3-Embedding-8B (4096 dim) - armazenado em Qdrant
# - Imagem: OpenCLIP ViT-H/14 (1024 dim) - armazenado em pgvector
# 
# GPU: RTX 4000 Ada (20GB VRAM) - Hetzner GEX44
# VRAM estimado: ~16GB para Qwen3 + ~2GB para OpenCLIP
# 
# OTIMIZAÇÃO BUILD (27/12/2025):
# - Imagem base pytorch/pytorch já tem PyTorch instalado (~3GB economia)
# - BuildKit cache mount para pip (--mount=type=cache)
# - Combina RUN commands para menos layers
# 
# Autor: Fillipe Guerra
# Data: 27 de Dezembro de 2025
# =============================================================================

# OTIMIZAÇÃO: Usar imagem oficial PyTorch (PyTorch já instalado!)
# Economia: ~3GB download + ~5min build time
FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime

LABEL maintainer="Fillipe Guerra"
LABEL description="Embeddings GPU Enterprise (Qwen3-Embedding-8B 4096 + OpenCLIP 1024)"
LABEL version="2.2.0"
LABEL architecture="unified"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_ROOT_USER_ACTION=ignore

# Instalar curl para healthcheck (imagem pytorch não tem)
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 embeddings
WORKDIR /app

# Instalar dependências - PyTorch JÁ INSTALADO na imagem base!
# OTIMIZAÇÃO: --mount=type=cache para cache persistente do pip
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install \
    torchvision==0.20.1 \
    transformers==4.47.1 \
    sentence-transformers==3.3.1 \
    open_clip_torch==2.29.0 \
    accelerate==1.2.1 \
    safetensors==0.4.5 \
    fastapi==0.115.6 \
    uvicorn==0.34.0 \
    python-multipart==0.0.20 \
    pillow==11.0.0 \
    numpy==2.2.1 \
    prometheus-client==0.21.1 \
    pybreaker==1.2.0

COPY app/ /app/
COPY healthcheck.py /app/healthcheck.py

RUN chown -R embeddings:embeddings /app
USER embeddings

# Configuração Enterprise (17/12/2025)
# Texto: Qwen3-Embedding-8B (8B params, 4096 dim) - melhor qualidade
# Imagem: OpenCLIP ViT-H/14 (1024 dim) - dimensão nativa
ENV TEXT_MODEL_NAME="Qwen/Qwen3-Embedding-8B"
ENV TEXT_EMBEDDING_DIM="4096"
ENV IMAGE_MODEL_NAME="laion/CLIP-ViT-H-14-laion2B-s32B-b79K"
ENV IMAGE_EMBEDDING_DIM="1024"
ENV DEVICE="cuda"
ENV PORT="8000"
# ENV KEEP_WARM_MINUTES removido - GPU dedicada 24/7 (Hetzner GEX44)

# Huggingface cache
ENV HF_HOME="/app/.cache/huggingface"
ENV TRANSFORMERS_CACHE="/app/.cache/huggingface/transformers"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
