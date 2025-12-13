FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git ffmpeg wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt

# Pré-baixa modelo XTTS v2 durante build para autonomia 100% (sem download em runtime)
# COQUI_TOS_AGREED=1 aceita automaticamente os termos de licença (necessário para build não-interativo)
ENV TTS_HOME=/opt/tts-models \
    COQUI_TOS_AGREED=1
# Força download completo do modelo chamando to() que carrega na memória
# Validação: se tts.to('cpu') executar sem erro, o modelo foi baixado e carregado corretamente
# set -euo pipefail garante que qualquer falha no Python abortará o build
RUN set -euo pipefail; \
    mkdir -p "$TTS_HOME"; \
    python3 -c "from TTS.api import TTS; tts = TTS('tts_models/multilingual/multi-dataset/xtts_v2'); tts.to('cpu'); print('Modelo XTTS v2 baixado e carregado com sucesso')"

COPY serve.py .

# Comentário: entrypoint simples que lê variáveis e gera o áudio no caminho indicado.
ENTRYPOINT ["python3", "/app/serve.py"]
