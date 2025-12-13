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

# Clona Wav2Lip em commit fixo (reprodutibilidade enterprise)
# Enterprise-grade: commit fixo garante builds determinísticos e reprodutíveis
# Commit: bac9a81e63ecc153202353372e5724b83d9e6322 (HEAD do master, 13/12/2025)
# NOTA: Se este commit não existir mais, atualizar para commit mais recente do master
# NOTA: Clone completo (sem --depth) para garantir que commit específico esteja disponível
RUN set -euo pipefail && \
    # Enterprise-grade: clone completo do master para garantir que commit específico esteja disponível
    # NOTA: git clone com branch master explícito garante que commit fixo esteja no histórico local
    git clone --branch master --no-single-branch https://github.com/Rudrabha/Wav2Lip.git /opt/wav2lip && \
    cd /opt/wav2lip && \
    git lfs install --local && \
    # Usar commit fixo para reprodutibilidade enterprise (builds determinísticos)
    # Commit: bac9a81e63ecc153202353372e5724b83d9e6322 (HEAD do master, 13/12/2025)
    # Enterprise-grade: commit fixo é OBRIGATÓRIO - sem fallback para garantir reprodutibilidade
    # Regra 6: PROIBIDO workarounds - build DEVE falhar se commit não existe
    WAV2LIP_COMMIT="bac9a81e63ecc153202353372e5724b83d9e6322" && \
    # Verificar se commit existe localmente (deve existir após clone completo do master)
    if git cat-file -e "$${WAV2LIP_COMMIT}^{commit}" 2>/dev/null; then \
      echo "Usando commit fixo: $${WAV2LIP_COMMIT}" && \
      git checkout "$${WAV2LIP_COMMIT}"; \
    else \
      echo "::error::Commit fixo não encontrado: $${WAV2LIP_COMMIT}" && \
      echo "::error::Branches disponíveis:" && \
      BRANCHES_OUTPUT=$$(git branch -r 2>/dev/null || echo "") && \
      if [ -n "$${BRANCHES_OUTPUT}" ]; then \
        echo "$${BRANCHES_OUTPUT}" | head -n 5; \
      else \
        echo "  (não disponível)"; \
      fi && \
      echo "::error::Último commit do master:" && \
      (git rev-parse origin/master 2>/dev/null || git rev-parse HEAD 2>/dev/null || echo "  (não disponível)") && \
      echo "::error::Atualize WAV2LIP_COMMIT no Dockerfile para commit válido do master" && \
      echo "::error::Build falhou - commit fixo é obrigatório para reprodutibilidade enterprise (Regra 6)" && \
      exit 1; \
    fi && \
    git lfs fetch --all && \
    git lfs pull && \
    python3 -m pip install --no-cache-dir -r requirements.txt

# Build args: apenas checksums (não secrets)
# Enterprise-grade: token HuggingFace via Docker BuildKit secrets (--mount=type=secret)
# Secrets não aparecem nos metadados da imagem, histórico de build ou layers
ARG WAV2LIP_CHECKPOINT_SHA256
RUN --mount=type=secret,id=huggingface_token \
    set -euo pipefail && \
    mkdir -p /opt/wav2lip/checkpoints && \
    # Função helper para download com token (obrigatório se configurado) - mesma lógica do workflow
    # Token lido de /run/secrets/huggingface_token (Docker BuildKit secret mount)
    download_with_token() { \
      local URL="$$1" && \
      local OUTPUT="$$2" && \
      local TOKEN="$$(cat /run/secrets/huggingface_token 2>/dev/null || echo '')" && \
      if [ -n "$${TOKEN}" ]; then \
        echo "Usando HUGGINGFACE_TOKEN para download autenticado..." && \
        HTTP_CODE=$$(curl -SL --retry 3 --retry-delay 5 --max-time 300 -H "Authorization: Bearer $${TOKEN}" -w "%{http_code}" -o "$${OUTPUT}" "$${URL}" 2>/dev/null || echo "000") && \
        if [ "$${HTTP_CODE}" = "200" ] && [ -s "$${OUTPUT}" ]; then \
          return 0; \
        elif [ "$${HTTP_CODE}" = "401" ]; then \
          echo "::error::401 Unauthorized - Token HuggingFace pode estar inválido ou expirado" && \
          return 1; \
        elif [ "$${HTTP_CODE}" = "403" ]; then \
          echo "::error::403 Forbidden - Token HuggingFace não tem permissão para acessar este repositório" && \
          return 1; \
        else \
          echo "::error::Download falhou com token (HTTP $${HTTP_CODE})" && \
          return 1; \
        fi; \
      else \
        echo "HUGGINGFACE_TOKEN não configurado - tentando download público (pode falhar com 401)" && \
        HTTP_CODE=$$(curl -SL --retry 3 --retry-delay 5 --max-time 300 -w "%{http_code}" -o "$${OUTPUT}" "$${URL}" 2>/dev/null || echo "000") && \
        if [ "$${HTTP_CODE}" = "200" ] && [ -s "$${OUTPUT}" ]; then \
          return 0; \
        elif [ "$${HTTP_CODE}" = "401" ] || [ "$${HTTP_CODE}" = "403" ]; then \
          echo "::error::Download requer autenticação (HTTP $${HTTP_CODE}) - configure HUGGINGFACE_TOKEN no GitHub Secrets" && \
          return 1; \
        else \
          echo "::error::Download falhou (HTTP $${HTTP_CODE})" && \
          return 1; \
        fi; \
      fi; \
    } && \
    # Enterprise-grade: múltiplas fontes com fallback sequencial + token (mesma lógica do workflow)
    # URL original do space fffiloni retorna 404, então usamos mirrors públicos do HuggingFace
    # NOTA: Usar loop for simples conforme documentação oficial Docker (melhores práticas)
    WAV2LIP_DOWNLOADED=false && \
    for SOURCE in \
      "https://huggingface.co/Nekochu/Wav2Lip/resolve/main/wav2lip_gan.pth|Nekochu/Wav2Lip" \
      "https://huggingface.co/gmk123/wav2lip/resolve/main/wav2lip_gan.pth|gmk123/wav2lip" \
      "https://huggingface.co/commanderx/Wav2Lip-HD/resolve/main/checkpoints/wav2lip_gan.pth|commanderx/Wav2Lip-HD" \
      "https://huggingface.co/spaces/fffiloni/wav2lip/resolve/main/wav2lip_gan.pth|fffiloni/wav2lip (space - pode retornar 404)"; \
    do \
      WAV2LIP_URL=$$(echo "$${SOURCE}" | cut -d'|' -f1) && \
      SOURCE_NAME=$$(echo "$${SOURCE}" | cut -d'|' -f2) && \
      echo "Tentando baixar wav2lip_gan.pth de $${SOURCE_NAME}..." && \
      if download_with_token "$${WAV2LIP_URL}" /opt/wav2lip/checkpoints/wav2lip_gan.pth; then \
        echo "Download bem-sucedido de $${SOURCE_NAME}" && \
        WAV2LIP_DOWNLOADED=true && \
        break; \
      else \
        echo "Falha ao baixar de $${SOURCE_NAME}" && \
        rm -f /opt/wav2lip/checkpoints/wav2lip_gan.pth; \
      fi; \
    done && \
    if [ "$${WAV2LIP_DOWNLOADED}" != "true" ]; then \
      echo "::error::Download de wav2lip_gan.pth falhou de todas as fontes" && \
      echo "::error::Configure HUGGINGFACE_TOKEN no GitHub Secrets (read-only token do HuggingFace) para acesso confiável" && \
      exit 1; \
    fi && \
    if [ ! -s /opt/wav2lip/checkpoints/wav2lip_gan.pth ]; then \
      echo "::error::wav2lip_gan.pth vazio ou ausente após download" && \
      exit 1; \
    fi && \
    # Command substitution: no nível RUN, usar $$ para escapar $ e passar literal ao shell
    # NOTA: Docker processa $ antes de passar ao shell, então $$ passa $ literal ao shell
    WAV2LIP_SIZE=$$(stat -f%z /opt/wav2lip/checkpoints/wav2lip_gan.pth 2>/dev/null || stat -c%s /opt/wav2lip/checkpoints/wav2lip_gan.pth 2>/dev/null || echo "0") && \
    if [ "$${WAV2LIP_SIZE}" -lt 400000000 ]; then \
      echo "::error::wav2lip_gan.pth corrompido (tamanho: $${WAV2LIP_SIZE} bytes, esperado: ~400MB)" && \
      exit 1; \
    fi && \
    if [ -z "${WAV2LIP_CHECKPOINT_SHA256:-}" ]; then \
      echo "::error::WAV2LIP_CHECKPOINT_SHA256 é obrigatório"; \
      exit 1; \
    fi; \
    # NOTA: ARG do Docker usa $ simples (não $$) - Docker expande ANTES de passar ao shell
    echo "${WAV2LIP_CHECKPOINT_SHA256}  /opt/wav2lip/checkpoints/wav2lip_gan.pth" | sha256sum -c -

# Baixa modelo de detecção de faces (s3fd.pth) obrigatório para inferência + valida checksum
# Enterprise-grade: múltiplas fontes com fallback sequencial + token (mesma lógica do workflow)
# URL original do Adrian Bulat retorna 401 Unauthorized, então usamos mirrors públicos do HuggingFace
# Token via Docker BuildKit secret mount (mesmo secret do download anterior)
ARG S3FD_SHA256
RUN --mount=type=secret,id=huggingface_token \
    set -euo pipefail && \
    mkdir -p /opt/wav2lip/face_detection/detection/sfd && \
    # Função helper para download com token (obrigatório se configurado) - mesma lógica do workflow
    # Token lido de /run/secrets/huggingface_token (Docker BuildKit secret mount)
    download_with_token() { \
      local URL="$$1" && \
      local OUTPUT="$$2" && \
      local TOKEN="$$(cat /run/secrets/huggingface_token 2>/dev/null || echo '')" && \
      if [ -n "$${TOKEN}" ]; then \
        echo "Usando HUGGINGFACE_TOKEN para download autenticado..." && \
        HTTP_CODE=$$(curl -SL --retry 3 --retry-delay 5 --max-time 300 -H "Authorization: Bearer $${TOKEN}" -w "%{http_code}" -o "$${OUTPUT}" "$${URL}" 2>/dev/null || echo "000") && \
        if [ "$${HTTP_CODE}" = "200" ] && [ -s "$${OUTPUT}" ]; then \
          return 0; \
        elif [ "$${HTTP_CODE}" = "401" ]; then \
          echo "::error::401 Unauthorized - Token HuggingFace pode estar inválido ou expirado" && \
          return 1; \
        elif [ "$${HTTP_CODE}" = "403" ]; then \
          echo "::error::403 Forbidden - Token HuggingFace não tem permissão para acessar este repositório" && \
          return 1; \
        else \
          echo "::error::Download falhou com token (HTTP $${HTTP_CODE})" && \
          return 1; \
        fi; \
      else \
        echo "HUGGINGFACE_TOKEN não configurado - tentando download público (pode falhar com 401)" && \
        HTTP_CODE=$$(curl -SL --retry 3 --retry-delay 5 --max-time 300 -w "%{http_code}" -o "$${OUTPUT}" "$${URL}" 2>/dev/null || echo "000") && \
        if [ "$${HTTP_CODE}" = "200" ] && [ -s "$${OUTPUT}" ]; then \
          return 0; \
        elif [ "$${HTTP_CODE}" = "401" ] || [ "$${HTTP_CODE}" = "403" ]; then \
          echo "::error::Download requer autenticação (HTTP $${HTTP_CODE}) - configure HUGGINGFACE_TOKEN no GitHub Secrets" && \
          return 1; \
        else \
          echo "::error::Download falhou (HTTP $${HTTP_CODE})" && \
          return 1; \
        fi; \
      fi; \
    } && \
    # NOTA: Usar loop for simples conforme documentação oficial Docker (melhores práticas)
    S3FD_DOWNLOADED=false && \
    for SOURCE in \
      "https://huggingface.co/gmk123/wav2lip/resolve/main/s3fd-619a316812.pth|gmk123/wav2lip" \
      "https://huggingface.co/spaces/manavisrani07/gradio-lipsync-wav2lip/resolve/main/face_detection/detection/sfd/s3fd.pth|manavisrani07/gradio-lipsync-wav2lip" \
      "https://huggingface.co/camenduru/Wav2Lip/resolve/main/checkpoints/s3fd-619a316812.pth|camenduru/Wav2Lip"; \
    do \
      S3FD_URL=$$(echo "$${SOURCE}" | cut -d'|' -f1) && \
      SOURCE_NAME=$$(echo "$${SOURCE}" | cut -d'|' -f2) && \
      echo "Tentando baixar s3fd.pth de $${SOURCE_NAME}..." && \
      if download_with_token "$${S3FD_URL}" /opt/wav2lip/face_detection/detection/sfd/s3fd.pth; then \
        echo "Download bem-sucedido de $${SOURCE_NAME}" && \
        S3FD_DOWNLOADED=true && \
        break; \
      else \
        echo "Falha ao baixar de $${SOURCE_NAME}" && \
        rm -f /opt/wav2lip/face_detection/detection/sfd/s3fd.pth; \
      fi; \
    done && \
    if [ "$${S3FD_DOWNLOADED}" != "true" ]; then \
      echo "::error::Download de s3fd.pth falhou de todas as fontes" && \
      echo "::error::Configure HUGGINGFACE_TOKEN no GitHub Secrets (read-only token do HuggingFace) para acesso confiável" && \
      exit 1; \
    fi && \
    if [ ! -s /opt/wav2lip/face_detection/detection/sfd/s3fd.pth ]; then \
      echo "::error::s3fd.pth vazio ou ausente após download" && \
      exit 1; \
    fi && \
    # Validação enterprise: verificar tamanho mínimo esperado (~85MB = 89128960 bytes)
    # Command substitution: no nível RUN, usar $$ para escapar $ e passar literal ao shell
    # NOTA: Docker processa $ antes de passar ao shell, então $$ passa $ literal ao shell
    S3FD_SIZE=$$(stat -f%z /opt/wav2lip/face_detection/detection/sfd/s3fd.pth 2>/dev/null || stat -c%s /opt/wav2lip/face_detection/detection/sfd/s3fd.pth 2>/dev/null || echo "0") && \
    if [ "$${S3FD_SIZE}" -lt 89128960 ]; then \
      echo "::error::s3fd.pth corrompido (tamanho: $${S3FD_SIZE} bytes, esperado: ~85MB = 89128960 bytes)" && \
      exit 1; \
    fi && \
    if [ -z "${S3FD_SHA256:-}" ]; then \
      echo "::error::S3FD_SHA256 é obrigatório"; \
      exit 1; \
    fi; \
    # NOTA: ARG do Docker usa $ simples (não $$) - Docker expande ANTES de passar ao shell
    echo "${S3FD_SHA256}  /opt/wav2lip/face_detection/detection/sfd/s3fd.pth" | sha256sum -c -

ENV PYTHONPATH="/opt/wav2lip:${PYTHONPATH}"

COPY serve.py .

# Comentário: gera vídeo lip-sync via Wav2Lip; saída em OUTPUT_PATH.
ENTRYPOINT ["python3", "/app/serve.py"]
