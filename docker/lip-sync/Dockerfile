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

# Clona Wav2Lip em commit fixo (reprodutibilidade) e instala deps locais
RUN set -euo pipefail; \
    git clone https://github.com/Rudrabha/Wav2Lip.git /opt/wav2lip; \
    cd /opt/wav2lip; \
    git lfs install --local; \
    git fetch origin; \
    git checkout d83d7e5ab24f535494cfc2e7a286fe9899bfa710; \
    git lfs fetch --all; git lfs pull; \
    python3 -m pip install --no-cache-dir -r requirements.txt

# Build args: apenas checksums (não secrets)
# Enterprise-grade: token HuggingFace via Docker BuildKit secrets (--mount=type=secret)
# Secrets não aparecem nos metadados da imagem, histórico de build ou layers
ARG WAV2LIP_CHECKPOINT_URL=https://huggingface.co/spaces/fffiloni/wav2lip/resolve/main/wav2lip_gan.pth
ARG WAV2LIP_CHECKPOINT_SHA256
RUN --mount=type=secret,id=huggingface_token \
    set -euo pipefail; \
    mkdir -p /opt/wav2lip/checkpoints; \
    # Função helper para download com token (obrigatório se configurado) - mesma lógica do workflow
    # Token lido de /run/secrets/huggingface_token (Docker BuildKit secret mount)
    download_with_token() { \
      local URL="$$1"; \
      local OUTPUT="$$2"; \
      local TOKEN="$$(cat /run/secrets/huggingface_token 2>/dev/null || echo '')"; \
      if [ -n "$$TOKEN" ]; then \
        echo "🔐 Usando HUGGINGFACE_TOKEN para download autenticado..."; \
        HTTP_CODE=$$(curl -SL --retry 3 --retry-delay 5 --max-time 300 -H "Authorization: Bearer $${TOKEN}" -w "%{http_code}" -o "$$OUTPUT" "$$URL" 2>/dev/null || echo "000"); \
        if [ "$$HTTP_CODE" = "200" ] && [ -s "$$OUTPUT" ]; then \
          return 0; \
        elif [ "$$HTTP_CODE" = "401" ]; then \
          echo "::error::401 Unauthorized - Token HuggingFace pode estar inválido ou expirado"; \
          return 1; \
        elif [ "$$HTTP_CODE" = "403" ]; then \
          echo "::error::403 Forbidden - Token HuggingFace não tem permissão para acessar este repositório"; \
          return 1; \
        else \
          echo "::error::Download falhou com token (HTTP $${HTTP_CODE})"; \
          return 1; \
        fi; \
      else \
        echo "⚠️ HUGGINGFACE_TOKEN não configurado - tentando download público (pode falhar com 401)"; \
        HTTP_CODE=$$(curl -SL --retry 3 --retry-delay 5 --max-time 300 -w "%{http_code}" -o "$$OUTPUT" "$$URL" 2>/dev/null || echo "000"); \
        if [ "$$HTTP_CODE" = "200" ] && [ -s "$$OUTPUT" ]; then \
          return 0; \
        elif [ "$$HTTP_CODE" = "401" ] || [ "$$HTTP_CODE" = "403" ]; then \
          echo "::error::Download requer autenticação (HTTP $${HTTP_CODE}) - configure HUGGINGFACE_TOKEN no GitHub Secrets"; \
          return 1; \
        else \
          echo "::error::Download falhou (HTTP $${HTTP_CODE})"; \
          return 1; \
        fi; \
      fi; \
    }; \
    if ! download_with_token "$WAV2LIP_CHECKPOINT_URL" /opt/wav2lip/checkpoints/wav2lip_gan.pth; then \
      echo "::error::Download de wav2lip_gan.pth falhou"; \
      exit 1; \
    fi; \
    if [ ! -s /opt/wav2lip/checkpoints/wav2lip_gan.pth ]; then \
      echo "::error::wav2lip_gan.pth está vazio"; \
      exit 1; \
    fi; \
    if [ -z "${WAV2LIP_CHECKPOINT_SHA256:-}" ]; then \
      echo "::error::WAV2LIP_CHECKPOINT_SHA256 é obrigatório"; \
      exit 1; \
    fi; \
    echo "${WAV2LIP_CHECKPOINT_SHA256}  /opt/wav2lip/checkpoints/wav2lip_gan.pth" | sha256sum -c -

# Baixa modelo de detecção de faces (s3fd.pth) obrigatório para inferência + valida checksum
# Enterprise-grade: múltiplas fontes com fallback sequencial + token (mesma lógica do workflow)
# URL original do Adrian Bulat retorna 401 Unauthorized, então usamos mirrors públicos do HuggingFace
# Token via Docker BuildKit secret mount (mesmo secret do download anterior)
ARG S3FD_SHA256
RUN --mount=type=secret,id=huggingface_token \
    set -euo pipefail; \
    mkdir -p /opt/wav2lip/face_detection/detection/sfd; \
    # Função helper para download com token (obrigatório se configurado) - mesma lógica do workflow
    # Token lido de /run/secrets/huggingface_token (Docker BuildKit secret mount)
    download_with_token() { \
      local URL="$$1"; \
      local OUTPUT="$$2"; \
      local TOKEN="$$(cat /run/secrets/huggingface_token 2>/dev/null || echo '')"; \
      if [ -n "$$TOKEN" ]; then \
        echo "🔐 Usando HUGGINGFACE_TOKEN para download autenticado..."; \
        HTTP_CODE=$$(curl -SL --retry 3 --retry-delay 5 --max-time 300 -H "Authorization: Bearer $${TOKEN}" -w "%{http_code}" -o "$$OUTPUT" "$$URL" 2>/dev/null || echo "000"); \
        if [ "$$HTTP_CODE" = "200" ] && [ -s "$$OUTPUT" ]; then \
          return 0; \
        elif [ "$$HTTP_CODE" = "401" ]; then \
          echo "::error::401 Unauthorized - Token HuggingFace pode estar inválido ou expirado"; \
          return 1; \
        elif [ "$$HTTP_CODE" = "403" ]; then \
          echo "::error::403 Forbidden - Token HuggingFace não tem permissão para acessar este repositório"; \
          return 1; \
        else \
          echo "::error::Download falhou com token (HTTP $${HTTP_CODE})"; \
          return 1; \
        fi; \
      else \
        echo "⚠️ HUGGINGFACE_TOKEN não configurado - tentando download público (pode falhar com 401)"; \
        HTTP_CODE=$$(curl -SL --retry 3 --retry-delay 5 --max-time 300 -w "%{http_code}" -o "$$OUTPUT" "$$URL" 2>/dev/null || echo "000"); \
        if [ "$$HTTP_CODE" = "200" ] && [ -s "$$OUTPUT" ]; then \
          return 0; \
        elif [ "$$HTTP_CODE" = "401" ] || [ "$$HTTP_CODE" = "403" ]; then \
          echo "::error::Download requer autenticação (HTTP $${HTTP_CODE}) - configure HUGGINGFACE_TOKEN no GitHub Secrets"; \
          return 1; \
        else \
          echo "::error::Download falhou (HTTP $${HTTP_CODE})"; \
          return 1; \
        fi; \
      fi; \
    }; \
    S3FD_DOWNLOADED=false; \
    S3FD_SOURCES=("https://huggingface.co/gmk123/wav2lip/resolve/main/s3fd-619a316812.pth|gmk123/wav2lip" \
                  "https://huggingface.co/spaces/manavisrani07/gradio-lipsync-wav2lip/resolve/main/face_detection/detection/sfd/s3fd.pth|manavisrani07/gradio-lipsync-wav2lip" \
                  "https://huggingface.co/camenduru/Wav2Lip/resolve/main/checkpoints/s3fd-619a316812.pth|camenduru/Wav2Lip"); \
    for SOURCE_INFO in $${S3FD_SOURCES[@]}; do \
      IFS='|' read -r S3FD_URL SOURCE_NAME <<< "$$SOURCE_INFO"; \
      echo "📦 Tentando baixar s3fd.pth de $${SOURCE_NAME}..."; \
      if download_with_token "$$S3FD_URL" /opt/wav2lip/face_detection/detection/sfd/s3fd.pth; then \
        echo "✅ Download bem-sucedido de $${SOURCE_NAME}"; \
        S3FD_DOWNLOADED=true; \
        break; \
      else \
        echo "⚠️ Falha ao baixar de $${SOURCE_NAME}"; \
        rm -f /opt/wav2lip/face_detection/detection/sfd/s3fd.pth; \
      fi; \
    done; \
    if [ "$$S3FD_DOWNLOADED" != "true" ]; then \
      echo "::error::Download de s3fd.pth falhou de todas as fontes"; \
      echo "::error::Configure HUGGINGFACE_TOKEN no GitHub Secrets (read-only token do HuggingFace) para acesso confiável"; \
      exit 1; \
    fi; \
    if [ ! -s /opt/wav2lip/face_detection/detection/sfd/s3fd.pth ]; then \
      echo "::error::s3fd.pth vazio ou ausente após download"; \
      exit 1; \
    fi; \
    S3FD_SIZE=$(stat -f%z /opt/wav2lip/face_detection/detection/sfd/s3fd.pth 2>/dev/null || stat -c%s /opt/wav2lip/face_detection/detection/sfd/s3fd.pth 2>/dev/null || echo "0"); \
    if [ "$$S3FD_SIZE" -lt 80000000 ]; then \
      echo "::error::s3fd.pth corrompido (tamanho: $${S3FD_SIZE} bytes, esperado: ~85MB)"; \
      exit 1; \
    fi; \
    if [ -z "${S3FD_SHA256:-}" ]; then \
      echo "::error::S3FD_SHA256 é obrigatório"; \
      exit 1; \
    fi; \
    echo "${S3FD_SHA256}  /opt/wav2lip/face_detection/detection/sfd/s3fd.pth" | sha256sum -c -

ENV PYTHONPATH="/opt/wav2lip:${PYTHONPATH}"

COPY serve.py .

# Comentário: gera vídeo lip-sync via Wav2Lip; saída em OUTPUT_PATH.
ENTRYPOINT ["python3", "/app/serve.py"]
