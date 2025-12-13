FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git ffmpeg libgl1 wget unzip ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt

# Clona SadTalker (sem setup.py); instala deps do projeto e exporta PYTHONPATH
RUN set -euo pipefail; \
    git clone https://github.com/OpenTalker/SadTalker.git /opt/sadtalker; \
    cd /opt/sadtalker; \
    python3 -m pip install --no-cache-dir -r requirements.txt; \
    if [ -f scripts/download_models.sh ]; then chmod +x scripts/download_models.sh && bash scripts/download_models.sh; else echo "download_models.sh não encontrado - prosseguindo sem download automático"; fi

ENV PYTHONPATH="/opt/sadtalker:${PYTHONPATH}"

COPY serve.py .

# Comentário: gera talking-head via SadTalker; saída em OUTPUT_PATH.
ENTRYPOINT ["python3", "/app/serve.py"]
