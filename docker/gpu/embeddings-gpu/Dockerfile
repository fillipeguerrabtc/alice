# =============================================================================
# Alice Enterprise Platform - Embeddings GPU (Dual-Dimension)
# =============================================================================
# Dockerfile para embeddings com arquitetura dual-dimension:
# - Texto: gte-Qwen2-7B-instruct (3584 dim nativo) - halfvec para Trading/RAG
# - Imagem: OpenCLIP ViT-H/14 (1024 dim nativo) - vector para análise visual
# 
# GPU: RTX 4090 (24GB VRAM)
# 
# Autor: Fillipe Guerra
# Data: 16 de Dezembro de 2025
# =============================================================================

FROM nvidia/cuda:12.1-runtime-ubuntu22.04

LABEL maintainer="Fillipe Guerra"
LABEL description="Embeddings GPU Dual-Dimension (gte-Qwen2 3584 + OpenCLIP 1024)"
LABEL version="1.0.0"
LABEL architecture="dual-dimension"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 embeddings
WORKDIR /app

# Instalar dependências
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir \
    torch>=2.1.0 \
    torchvision \
    transformers>=4.40.0 \
    sentence-transformers>=3.0.0 \
    open_clip_torch>=2.24.0 \
    accelerate \
    safetensors \
    fastapi \
    uvicorn \
    python-multipart \
    pillow \
    numpy \
    prometheus-client \
    pybreaker

COPY app/ /app/
COPY healthcheck.py /app/healthcheck.py

RUN chown -R embeddings:embeddings /app
USER embeddings

# Configuração dual-dimension
# Bug fix: gte-Qwen2-7B-instruct tem 3584 dimensões nativamente (não 4000)
ENV TEXT_MODEL_NAME="Alibaba-NLP/gte-Qwen2-7B-instruct"
ENV TEXT_EMBEDDING_DIM="3584"
ENV IMAGE_MODEL_NAME="laion/CLIP-ViT-H-14-laion2B-s32B-b79K"
ENV IMAGE_EMBEDDING_DIM="1024"
ENV DEVICE="cuda"
ENV PORT="8000"
ENV KEEP_WARM_MINUTES="30"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
