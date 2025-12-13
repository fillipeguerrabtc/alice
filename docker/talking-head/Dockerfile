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

# Clona SadTalker (sem setup.py); instala deps do projeto e exporta PYTHONPATH
# Enterprise-grade: timeout e tratamento de erro robusto para evitar loops infinitos
RUN set -euo pipefail; \
    git clone https://github.com/OpenTalker/SadTalker.git /opt/sadtalker; \
    cd /opt/sadtalker; \
    python3 -m pip install --no-cache-dir -r requirements.txt; \
    if [ -f scripts/download_models.sh ]; then \
      chmod +x scripts/download_models.sh; \
      # Enterprise-grade: modificar temporariamente o script para adicionar timeout aos wget
      # O script original pode ter wget sem timeout, causando loops infinitos
      # Solução robusta: substituir apenas comandos wget reais (não em strings/comentários)
      # Formato real: wget -nc <URL> -O <output> (onde -nc vem logo após wget)
      # Padrão corresponde a: início de linha/operador + espaços + wget + espaço + -nc + resto da linha
      # Isso evita substituir em contextos inválidos (strings, variáveis, comentários)
      # NOTA: Esta abordagem é mais segura que substituição global simples, mas ainda pode ter edge cases
      # Se o script tiver estruturas muito complexas, considere usar uma ferramenta mais robusta (awk/perl)
      sed -i -E 's|^([[:space:]]*)wget([[:space:]]+)-nc(.*)|\1wget\2--timeout=300 --tries=3 -nc\3|g; s|([;&|]|[[:space:]]&&|[[:space:]]\|\|)([[:space:]]*)wget([[:space:]]+)-nc(.*)|\1\2wget\3--timeout=300 --tries=3 -nc\4|g' scripts/download_models.sh || true; \
      # Timeout de 45 minutos (2700s) para evitar loops infinitos - downloads podem ser grandes (~1GB+)
      # coreutils garante que timeout está disponível
      timeout 2700 bash scripts/download_models.sh || { \
        EXIT_CODE=$$?; \
        if [ $$EXIT_CODE -eq 124 ]; then \
          echo "::error::Download de modelos SadTalker excedeu timeout de 45 minutos"; \
          echo "::error::Possível loop infinito ou download muito lento - verifique logs acima"; \
        else \
          echo "::error::Download de modelos SadTalker falhou (código: $$EXIT_CODE)"; \
          echo "::error::Verifique logs acima para identificar qual download falhou"; \
        fi; \
        exit 1; \
      }; \
      # Validação enterprise: verificar se checkpoints foram baixados corretamente
      if [ ! -d checkpoints ] || [ -z "$$(ls -A checkpoints 2>/dev/null)" ]; then \
        echo "::error::Diretório checkpoints vazio ou ausente após download"; \
        exit 1; \
      fi; \
      # Validação adicional: verificar se arquivos principais existem (safetensors ou pth.tar)
      CHECKPOINT_FILES=$$(find checkpoints -type f \( -name "*.safetensors" -o -name "*.pth.tar" -o -name "*.pth" \) 2>/dev/null | wc -l); \
      if [ "$$CHECKPOINT_FILES" -eq 0 ]; then \
        echo "::error::Nenhum arquivo de checkpoint encontrado em checkpoints/ após download"; \
        echo "::error::Arquivos esperados: *.safetensors, *.pth.tar ou *.pth"; \
        exit 1; \
      fi; \
      echo "✅ Modelos SadTalker baixados com sucesso ($$CHECKPOINT_FILES arquivos encontrados)"; \
    else \
      echo "::error::scripts/download_models.sh não encontrado no repositório SadTalker"; \
      exit 1; \
    fi

ENV PYTHONPATH="/opt/sadtalker:${PYTHONPATH}"

COPY serve.py .

# Comentário: gera talking-head via SadTalker; saída em OUTPUT_PATH.
ENTRYPOINT ["python3", "/app/serve.py"]
