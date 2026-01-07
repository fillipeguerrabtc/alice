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
LABEL description="Embeddings GPU Enterprise (Qwen3-Embedding-8B 4096 + OpenCLIP 1024)"
LABEL version="3.1.0"
LABEL architecture="unified"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_ROOT_USER_ACTION=ignore

# Instalar curl para healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# SECURITY HARDENING: Criar usuário não-root (Best Practice 2025)
RUN useradd -m -u 1000 embeddings
WORKDIR /app

# Instalar dependências - PyTorch JÁ INSTALADO na imagem base!
# ENTERPRISE 07/01/2026: Usar requirements.txt para SSOT (Dependabot monitora)
# NOTA: torchvision omitido - imagem base já inclui versão compatível
COPY requirements.txt /app/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install -r /app/requirements.txt

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

# Huggingface cache
ENV HF_HOME="/app/.cache/huggingface"
ENV TRANSFORMERS_CACHE="/app/.cache/huggingface/transformers"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
