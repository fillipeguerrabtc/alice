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
    git fetch origin; \
    git checkout d83d7e5ab24f535494cfc2e7a286fe9899bfa710; \
    git lfs install --local; git lfs fetch --all; git lfs pull; \
    python3 -m pip install --no-cache-dir -r requirements.txt

# Baixa checkpoint oficial (Wav2Lip GAN) em path esperado
RUN set -euo pipefail; \
    mkdir -p /opt/wav2lip/checkpoints; \
    wget --tries=3 --timeout=30 -O /opt/wav2lip/checkpoints/wav2lip_gan.pth https://github.com/Rudrabha/Wav2Lip/releases/download/v0.1/wav2lip_gan.pth && \
    if [ ! -s /opt/wav2lip/checkpoints/wav2lip_gan.pth ]; then echo "checkpoint vazio ou ausente"; exit 1; fi

ENV PYTHONPATH="/opt/wav2lip:${PYTHONPATH}"

COPY serve.py .

# Comentário: gera vídeo lip-sync via Wav2Lip; saída em OUTPUT_PATH.
ENTRYPOINT ["python3", "/app/serve.py"]
