# Dockerfile para lip-sync service
# Enterprise-grade: scripts externos para lógica complexa (melhor prática Docker)
# Autor: Fillipe Guerra
# Data: 13/12/2025

FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git git-lfs ffmpeg libgl1 wget curl unzip ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt

# Copiar scripts de setup (melhor prática: lógica complexa em scripts externos)
COPY setup_wav2lip.sh /tmp/setup_wav2lip.sh
COPY download_models.sh /tmp/download_models.sh

# Clona Wav2Lip em commit fixo (reprodutibilidade enterprise)
# Script externo evita problemas de escape em Dockerfiles
RUN chmod +x /tmp/setup_wav2lip.sh && \
    /tmp/setup_wav2lip.sh && \
    rm /tmp/setup_wav2lip.sh

# Build args: checksums dos modelos ML (obrigatórios para validação)
ARG WAV2LIP_CHECKPOINT_SHA256
ARG S3FD_SHA256

# Baixa modelos com token HuggingFace (via Docker BuildKit secret)
# Script externo evita problemas de escape em Dockerfiles
RUN --mount=type=secret,id=huggingface_token \
    chmod +x /tmp/download_models.sh && \
    export WAV2LIP_CHECKPOINT_SHA256="${WAV2LIP_CHECKPOINT_SHA256}" && \
    export S3FD_SHA256="${S3FD_SHA256}" && \
    /tmp/download_models.sh && \
    rm /tmp/download_models.sh

ENV PYTHONPATH="/opt/wav2lip:${PYTHONPATH}"

COPY serve.py .

# Comentário: gera vídeo lip-sync via Wav2Lip; saída em OUTPUT_PATH.
ENTRYPOINT ["python3", "/app/serve.py"]
