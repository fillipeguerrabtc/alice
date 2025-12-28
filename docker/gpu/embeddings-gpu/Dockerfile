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
# ARQUITETURA ENTERPRISE NGC (28/12/2025):
# - Base: nvcr.io/nvidia/pytorch:25.12-py3 (container oficial NVIDIA - PÚBLICO)
# - PyTorch: 2.10.0a0 otimizado pela NVIDIA
# - CUDA: 13.1 com kernels otimizados
# - TensorRT Model Optimizer incluído
# - Transformer Engine incluído (FP8 support)
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

# Instalar dependências - PyTorch JÁ INSTALADO na imagem NGC!
# ENTERPRISE 28/12/2025: Versões mais recentes de todas as dependências
# NOTA: torchvision omitido - NGC 25.12 já inclui versão compatível
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install \
    transformers==4.57.3 \
    sentence-transformers==5.2.0 \
    open_clip_torch==3.2.0 \
    accelerate==1.12.0 \
    safetensors==0.7.0 \
    fastapi==0.127.0 \
    uvicorn==0.40.0 \
    python-multipart==0.0.21 \
    pillow==12.0.0 \
    numpy==2.4.0 \
    prometheus-client==0.23.1 \
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

# Huggingface cache
ENV HF_HOME="/app/.cache/huggingface"
ENV TRANSFORMERS_CACHE="/app/.cache/huggingface/transformers"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
