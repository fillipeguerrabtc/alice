# Dockerfile para talking-head service
# Enterprise-grade: script externo para lógica complexa (melhor prática Docker)
# Autor: Fillipe Guerra
# Data: 13/12/2025

FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git ffmpeg libgl1 wget unzip ca-certificates coreutils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt

# Copiar script de setup (melhor prática: lógica complexa em scripts externos)
COPY setup_sadtalker.sh /tmp/setup_sadtalker.sh

# Clona SadTalker e baixa modelos
# Script externo evita problemas de escape em Dockerfiles
RUN chmod +x /tmp/setup_sadtalker.sh && \
    /tmp/setup_sadtalker.sh && \
    rm /tmp/setup_sadtalker.sh

ENV PYTHONPATH="/opt/sadtalker:${PYTHONPATH}"

COPY serve.py .

# Comentário: gera talking-head via SadTalker; saída em OUTPUT_PATH.
ENTRYPOINT ["python3", "/app/serve.py"]
