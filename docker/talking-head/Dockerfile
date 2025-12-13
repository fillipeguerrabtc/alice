FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git ffmpeg libgl1 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt

# Clona SadTalker (sem setup.py); instala deps do projeto e exporta PYTHONPATH
RUN git clone --depth 1 https://github.com/OpenTalker/SadTalker.git /opt/sadtalker && \
    python3 -m pip install --no-cache-dir -r /opt/sadtalker/requirements.txt

ENV PYTHONPATH="/opt/sadtalker:${PYTHONPATH}"

COPY serve.py .

# Comentário: gera talking-head via SadTalker; saída em OUTPUT_PATH.
ENTRYPOINT ["python3", "/app/serve.py"]
