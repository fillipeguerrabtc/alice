# =============================================================================
# Alice Enterprise Platform - FLUX.1 Schnell
# =============================================================================
# Dockerfile para geração de imagens com FLUX.1 Schnell em GPU RTX 4000 SFF Ada (20GB)
# 
# Autor: Fillipe Guerra
# Data: 27 de Dezembro de 2025
# =============================================================================

FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

LABEL maintainer="Fillipe Guerra"
LABEL description="FLUX.1 Schnell image generation server"
LABEL version="1.1.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
# Silenciar warning do pip (instalação como root é intencional durante build)
ENV PIP_ROOT_USER_ACTION=ignore

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 flux
WORKDIR /app

# Instalar dependências - Versões pinadas Dezembro 2025
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir \
    torch==2.5.1 \
    diffusers==0.32.2 \
    transformers==4.47.1 \
    accelerate==1.2.1 \
    safetensors==0.4.5 \
    sentencepiece==0.2.0 \
    fastapi==0.115.6 \
    uvicorn==0.34.0 \
    python-multipart==0.0.20 \
    pillow==11.0.0 \
    prometheus-client==0.21.1

COPY app/ /app/
COPY healthcheck.py /app/healthcheck.py

RUN chown -R flux:flux /app
USER flux

ENV MODEL_NAME="black-forest-labs/FLUX.1-schnell"
ENV NUM_INFERENCE_STEPS="4"
ENV PORT="8000"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
