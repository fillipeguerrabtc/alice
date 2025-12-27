# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - ASR Canary-1B
# =============================================================================
# Dockerfile para transcrição de áudio com Canary em GPU RTX 4000 SFF Ada (20GB)
# 
# OTIMIZAÇÃO BUILD (27/12/2025):
# - Imagem base pytorch/pytorch já tem PyTorch instalado (~3GB economia)
# - BuildKit cache mount para pip (--mount=type=cache)
# - NeMo instalado separadamente (pacote pesado)
# 
# Autor: Fillipe Guerra
# Data: 27 de Dezembro de 2025
# =============================================================================

# OTIMIZAÇÃO: Usar imagem oficial PyTorch (PyTorch já instalado!)
# ENTERPRISE 27/12/2025: PyTorch 2.9.1 + CUDA 13.0 (versões mais recentes disponíveis)
# Servidor Hetzner GEX44: Driver NVIDIA 580.95.05 + CUDA 13.0
FROM pytorch/pytorch:2.9.1-cuda13.0-cudnn9-runtime

LABEL maintainer="Fillipe Guerra"
LABEL description="ASR Canary-1B speech-to-text server"
LABEL version="1.2.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_ROOT_USER_ACTION=ignore

# Instalar dependências do sistema (ffmpeg para processamento de áudio)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 asr
WORKDIR /app

# Instalar dependências Python - PyTorch JÁ INSTALADO na imagem base!
# ENTERPRISE 27/12/2025: Versões mais recentes compatíveis com PyTorch 2.9.1
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install \
    torchaudio==2.9.1 \
    transformers==4.48.0 \
    accelerate==1.3.0 \
    fastapi==0.115.6 \
    uvicorn==0.34.0 \
    python-multipart==0.0.20 \
    pydub==0.25.1 \
    prometheus-client==0.21.1 \
    pybreaker==1.2.0

# NeMo em layer separado (muito pesado, melhor cache isolado)
# ENTERPRISE 27/12/2025: NeMo 2.3 com suporte PyTorch 2.9
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install nemo_toolkit[asr]==2.3.0

# Copiar código da aplicação
COPY app/ /app/
COPY healthcheck.py /app/healthcheck.py

# Configurar permissões
RUN chown -R asr:asr /app

USER asr

# Variáveis de ambiente
ENV MODEL_NAME="nvidia/canary-1b"
ENV DEVICE="cuda"
ENV PORT="8000"
ENV HOST="0.0.0.0"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
