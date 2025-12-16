# =============================================================================
# Alice Enterprise Platform - ASR Canary-Qwen-2.5B
# =============================================================================
# Dockerfile para transcrição de áudio com Canary/Whisper em GPU RTX 4090
# 
# Autor: Fillipe Guerra
# Data: 16 de Dezembro de 2025
# =============================================================================

FROM nvidia/cuda:12.1-runtime-ubuntu22.04

LABEL maintainer="Fillipe Guerra"
LABEL description="ASR Canary-Qwen speech-to-text server"
LABEL version="1.0.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Criar usuário não-root
RUN useradd -m -u 1000 asr
WORKDIR /app

# Instalar dependências Python
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir \
    torch>=2.1.0 \
    torchaudio \
    transformers>=4.40.0 \
    accelerate \
    nemo_toolkit[asr] \
    fastapi \
    uvicorn \
    python-multipart \
    pydub \
    prometheus-client \
    pybreaker

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
