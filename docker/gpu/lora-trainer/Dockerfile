# =============================================================================
# Alice Enterprise Platform - LoRA Trainer (GPU)
# =============================================================================
# Serviço GPU para fine-tuning LoRA/QLoRA no servidor Hetzner GEX44 (RTX 4000 Ada 20GB).
# - Objetivo: executar slices curtas de treinamento para permitir preempção (chat > embeddings > training)
# - Persistência: checkpoints/adapters em /opt/alice/uploads/training (bind mount)
#
# Autor: Fillipe Guerra
# Data: 26 de Dezembro de 2025
# =============================================================================

FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

LABEL maintainer="Fillipe Guerra"
LABEL description="LoRA Trainer GPU (Fine-tuning enterprise) - Alice Platform"
LABEL version="1.0.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 trainer
WORKDIR /app

# Dependências de ML (2025 baseline)
# NOTA: versões são mantidas amplas aqui pois a build ocorre via pipeline tagueada.
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir \
    torch>=2.1.0 \
    transformers>=4.40.0 \
    accelerate>=0.30.0 \
    datasets>=2.20.0 \
    peft>=0.12.0 \
    bitsandbytes>=0.43.0 \
    safetensors \
    huggingface_hub \
    fastapi \
    uvicorn \
    pydantic \
    numpy \
    prometheus-client

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


