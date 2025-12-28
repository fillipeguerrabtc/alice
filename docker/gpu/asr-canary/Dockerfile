# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - ASR Canary-1B
# =============================================================================
# Dockerfile para transcrição de áudio com Canary em GPU RTX 4000 SFF Ada (20GB)
# 
# ARQUITETURA ENTERPRISE (27/12/2025):
# - Base: pytorch/pytorch:2.9.1-cuda13.0-cudnn9-runtime (PyTorch + CUDA 13.0)
# - NeMo: 2.5.0 via pip (compatível com PyTorch 2.9)
# - Servidor Hetzner GEX44: Driver NVIDIA 580.95.05 (suporta CUDA 13.0)
# 
# NOTA: NVIDIA NGC (nvcr.io/nvidia/nemo) requer autenticação NGC_API_KEY
# Solução: Usar imagem base PyTorch pública + NeMo via pip
# 
# Ref: https://docs.nvidia.com/nemo-framework/user-guide/25.11/installation.html
# 
# Autor: Fillipe Guerra
# Data: 27 de Dezembro de 2025
# =============================================================================

# ENTERPRISE 27/12/2025: Imagem base PyTorch oficial com CUDA 13.0 (pública)
# Consistente com outros serviços GPU (mixtral, embeddings, flux, lora-trainer)
FROM pytorch/pytorch:2.9.1-cuda13.0-cudnn9-runtime

LABEL maintainer="Fillipe Guerra"
LABEL description="ASR Canary-1B speech-to-text server"
LABEL version="2.1.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_ROOT_USER_ACTION=ignore

# Instalar dependências do sistema para NeMo ASR
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    sox \
    && rm -rf /var/lib/apt/lists/*

# SECURITY HARDENING: Criar usuário não-root (Best Practice 2025)
# Consistente com outros serviços GPU (embeddings, flux, mixtral, lora-trainer)
# Ref: CLAUDE.md "51 containers = 100% com security_opt: no-new-privileges"
RUN useradd -m -u 1000 asr

WORKDIR /app

# Instalar NeMo ASR e dependências
# NOTA: NeMo 2.5.0 é compatível com PyTorch 2.9 (verificado em documentação oficial)
# Ref: https://docs.nvidia.com/nemo-framework/user-guide/25.11/installation.html
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install Cython packaging && \
    pip install \
    "nemo_toolkit[asr]==2.5.0" \
    "numpy<2.0"

# Dependências adicionais para API e métricas
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install \
    fastapi==0.115.6 \
    uvicorn==0.34.0 \
    python-multipart==0.0.20 \
    pydub==0.25.1 \
    prometheus-client==0.21.1 \
    pybreaker==1.2.0

# Copiar código da aplicação
COPY app/ /app/
COPY healthcheck.py /app/healthcheck.py

# Configurar permissões e mudar para usuário não-root
RUN chown -R asr:asr /app
USER asr

# Variáveis de ambiente
# ENTERPRISE 27/12/2025: Canary-1B-v2 (multilíngue, 25 idiomas, 10x mais rápido)
ENV MODEL_NAME="nvidia/canary-1b-v2"
ENV DEVICE="cuda"
ENV PORT="8000"
ENV HOST="0.0.0.0"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
