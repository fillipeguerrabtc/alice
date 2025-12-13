FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git ffmpeg libgl1 wget unzip && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt

# Clona Wav2Lip em commit fixo (reprodutibilidade) e instala deps locais
RUN git clone --depth 1 https://github.com/Rudrabha/Wav2Lip.git /opt/wav2lip && \
    cd /opt/wav2lip && \
    git fetch --depth 1 origin d83d7e5ab24f535494cfc2e7a286fe9899bfa710 && \
    git checkout d83d7e5ab24f535494cfc2e7a286fe9899bfa710 && \
    python3 -m pip install --no-cache-dir -r requirements.txt

ENV PYTHONPATH="/opt/wav2lip:${PYTHONPATH}"

COPY serve.py .

# Comentário: gera vídeo lip-sync via Wav2Lip; saída em OUTPUT_PATH.
ENTRYPOINT ["python3", "/app/serve.py"]
