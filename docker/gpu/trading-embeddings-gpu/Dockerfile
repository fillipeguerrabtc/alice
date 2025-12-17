# =============================================================================
# Alice Enterprise Platform - Trading Embeddings GPU (Qwen3-Embedding-8B)
# =============================================================================
# Dockerfile para embeddings de Trading com máxima qualidade:
# - Modelo: Qwen/Qwen3-Embedding-8B
# - Dimensões: 8192 (máxima qualidade para Trading)
# - Storage: Qdrant (suporta até 32.768 dim com HNSW index)
# 
# GPU: RTX 4090 (24GB VRAM)
# VRAM estimado: ~16GB para o modelo em full precision
# 
# Autor: Fillipe Guerra
# Data: 17 de Dezembro de 2025
# =============================================================================

FROM nvidia/cuda:12.1-runtime-ubuntu22.04

LABEL maintainer="Fillipe Guerra"
LABEL description="Trading Embeddings GPU - Qwen3-Embedding-8B (8192 dim)"
LABEL version="1.0.0"
LABEL architecture="trading-8192"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 embeddings
WORKDIR /app

# Instalar dependências
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir \
    torch>=2.1.0 \
    transformers>=4.45.0 \
    sentence-transformers>=3.3.0 \
    accelerate>=1.0.0 \
    safetensors \
    fastapi \
    uvicorn[standard] \
    python-multipart \
    numpy \
    prometheus-client \
    pybreaker \
    flash-attn>=2.5.0 --no-build-isolation

COPY app/ /app/
COPY healthcheck.py /app/healthcheck.py

RUN chown -R embeddings:embeddings /app
USER embeddings

# Configuração para Trading Embeddings
# Qwen3-Embedding-8B: 8192 dimensões nativas (máxima qualidade)
ENV MODEL_NAME="Qwen/Qwen3-Embedding-8B"
ENV EMBEDDING_DIM="8192"
ENV MAX_LENGTH="8192"
ENV DEVICE="cuda"
ENV PORT="8000"
ENV KEEP_WARM_MINUTES="30"

# Huggingface cache
ENV HF_HOME="/app/.cache/huggingface"
ENV TRANSFORMERS_CACHE="/app/.cache/huggingface/transformers"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
