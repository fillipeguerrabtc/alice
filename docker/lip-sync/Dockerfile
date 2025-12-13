FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git git-lfs ffmpeg libgl1 wget unzip ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt

# Clona Wav2Lip em commit fixo (reprodutibilidade) e instala deps locais
RUN set -euo pipefail; \
    git clone https://github.com/Rudrabha/Wav2Lip.git /opt/wav2lip; \
    cd /opt/wav2lip; \
    git lfs install --local; \
    git fetch origin; \
    git checkout d83d7e5ab24f535494cfc2e7a286fe9899bfa710; \
    git lfs fetch --all; git lfs pull; \
    python3 -m pip install --no-cache-dir -r requirements.txt

# Baixa checkpoint oficial (Wav2Lip GAN) em path esperado + valida checksum
ARG WAV2LIP_CHECKPOINT_URL=https://huggingface.co/spaces/fffiloni/wav2lip/resolve/main/wav2lip_gan.pth
ARG WAV2LIP_CHECKPOINT_SHA256
RUN set -euo pipefail; \
    mkdir -p /opt/wav2lip/checkpoints; \
    wget --tries=3 --timeout=30 -O /opt/wav2lip/checkpoints/wav2lip_gan.pth "$WAV2LIP_CHECKPOINT_URL"; \
    if [ ! -s /opt/wav2lip/checkpoints/wav2lip_gan.pth ]; then echo "checkpoint vazio ou ausente"; exit 1; fi; \
    if [ -z "${WAV2LIP_CHECKPOINT_SHA256:-}" ]; then echo "WAV2LIP_CHECKPOINT_SHA256 é obrigatório"; exit 1; fi; \
    echo "${WAV2LIP_CHECKPOINT_SHA256}  /opt/wav2lip/checkpoints/wav2lip_gan.pth" | sha256sum -c -

# Baixa modelo de detecção de faces (s3fd.pth) obrigatório para inferência + valida checksum
# Enterprise-grade: múltiplas fontes com fallback (URL original do Adrian Bulat retorna 401)
# Tentativa 1: gmk123/wav2lip (repositório público, arquivo na raiz)
ARG S3FD_URL=https://huggingface.co/gmk123/wav2lip/resolve/main/s3fd-619a316812.pth
ARG S3FD_SHA256
RUN set -euo pipefail; \
    mkdir -p /opt/wav2lip/face_detection/detection/sfd; \
    if ! wget --tries=3 --timeout=300 --progress=dot:giga -O /opt/wav2lip/face_detection/detection/sfd/s3fd.pth "$S3FD_URL" 2>/dev/null || [ ! -s /opt/wav2lip/face_detection/detection/sfd/s3fd.pth ]; then \
      echo "⚠️ Fallback: tentando alternativa (manavisrani07/gradio-lipsync-wav2lip)..."; \
      S3FD_URL_FALLBACK="https://huggingface.co/spaces/manavisrani07/gradio-lipsync-wav2lip/resolve/main/face_detection/detection/sfd/s3fd.pth"; \
      wget --tries=3 --timeout=300 --progress=dot:giga -O /opt/wav2lip/face_detection/detection/sfd/s3fd.pth "$S3FD_URL_FALLBACK"; \
    fi; \
    if [ ! -s /opt/wav2lip/face_detection/detection/sfd/s3fd.pth ]; then echo "s3fd.pth vazio ou ausente"; exit 1; fi; \
    S3FD_SIZE=$(stat -f%z /opt/wav2lip/face_detection/detection/sfd/s3fd.pth 2>/dev/null || stat -c%s /opt/wav2lip/face_detection/detection/sfd/s3fd.pth 2>/dev/null || echo "0"); \
    if [ "$S3FD_SIZE" -lt 80000000 ]; then echo "s3fd.pth corrompido (tamanho: ${S3FD_SIZE} bytes, esperado: ~85MB)"; exit 1; fi; \
    if [ -z "${S3FD_SHA256:-}" ]; then echo "S3FD_SHA256 é obrigatório"; exit 1; fi; \
    echo "${S3FD_SHA256}  /opt/wav2lip/face_detection/detection/sfd/s3fd.pth" | sha256sum -c -

ENV PYTHONPATH="/opt/wav2lip:${PYTHONPATH}"

COPY serve.py .

# Comentário: gera vídeo lip-sync via Wav2Lip; saída em OUTPUT_PATH.
ENTRYPOINT ["python3", "/app/serve.py"]
