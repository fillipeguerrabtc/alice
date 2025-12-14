#!/bin/bash
# Script para baixar modelos Wav2Lip
# Enterprise-grade: múltiplas fontes com fallback + validação
# Autor: Fillipe Guerra
# Data: 13/12/2025

set -euo pipefail

# Token HuggingFace lido do secret mount (se disponível)
TOKEN=""
if [ -f /run/secrets/huggingface_token ]; then
    TOKEN=$(cat /run/secrets/huggingface_token 2>/dev/null || echo "")
fi

# Checksums passados via variáveis de ambiente (obrigatórios)
WAV2LIP_CHECKPOINT_SHA256="${WAV2LIP_CHECKPOINT_SHA256:-}"
S3FD_SHA256="${S3FD_SHA256:-}"

# Função helper para download com token
download_with_token() {
    local URL="$1"
    local OUTPUT="$2"
    local HTTP_CODE
    
    if [ -n "${TOKEN}" ]; then
        echo "Usando HUGGINGFACE_TOKEN para download autenticado..."
        HTTP_CODE=$(curl -SL --retry 3 --retry-delay 5 --max-time 300 \
            -H "Authorization: Bearer ${TOKEN}" \
            -w "%{http_code}" -o "${OUTPUT}" "${URL}" 2>/dev/null || echo "000")
        
        if [ "${HTTP_CODE}" = "200" ] && [ -s "${OUTPUT}" ]; then
            return 0
        elif [ "${HTTP_CODE}" = "401" ]; then
            echo "::error::401 Unauthorized - Token HuggingFace pode estar inválido ou expirado"
            return 1
        elif [ "${HTTP_CODE}" = "403" ]; then
            echo "::error::403 Forbidden - Token HuggingFace não tem permissão para acessar este repositório"
            return 1
        else
            echo "::error::Download falhou com token (HTTP ${HTTP_CODE})"
            return 1
        fi
    else
        echo "HUGGINGFACE_TOKEN não configurado - tentando download público (pode falhar com 401)"
        HTTP_CODE=$(curl -SL --retry 3 --retry-delay 5 --max-time 300 \
            -w "%{http_code}" -o "${OUTPUT}" "${URL}" 2>/dev/null || echo "000")
        
        if [ "${HTTP_CODE}" = "200" ] && [ -s "${OUTPUT}" ]; then
            return 0
        elif [ "${HTTP_CODE}" = "401" ] || [ "${HTTP_CODE}" = "403" ]; then
            echo "::error::Download requer autenticação (HTTP ${HTTP_CODE}) - configure HUGGINGFACE_TOKEN no GitHub Secrets"
            return 1
        else
            echo "::error::Download falhou (HTTP ${HTTP_CODE})"
            return 1
        fi
    fi
}

# Criar diretórios
mkdir -p /opt/wav2lip/checkpoints
mkdir -p /opt/wav2lip/face_detection/detection/sfd

echo "=== Baixando wav2lip_gan.pth ==="

WAV2LIP_SOURCES=(
    "https://huggingface.co/Nekochu/Wav2Lip/resolve/main/wav2lip_gan.pth|Nekochu/Wav2Lip"
    "https://huggingface.co/gmk123/wav2lip/resolve/main/wav2lip_gan.pth|gmk123/wav2lip"
    "https://huggingface.co/commanderx/Wav2Lip-HD/resolve/main/checkpoints/wav2lip_gan.pth|commanderx/Wav2Lip-HD"
    "https://huggingface.co/spaces/fffiloni/wav2lip/resolve/main/wav2lip_gan.pth|fffiloni/wav2lip"
)

WAV2LIP_DOWNLOADED=false
for SOURCE in "${WAV2LIP_SOURCES[@]}"; do
    WAV2LIP_URL=$(echo "${SOURCE}" | cut -d'|' -f1)
    SOURCE_NAME=$(echo "${SOURCE}" | cut -d'|' -f2)
    
    echo "Tentando baixar wav2lip_gan.pth de ${SOURCE_NAME}..."
    if download_with_token "${WAV2LIP_URL}" /opt/wav2lip/checkpoints/wav2lip_gan.pth; then
        echo "Download bem-sucedido de ${SOURCE_NAME}"
        WAV2LIP_DOWNLOADED=true
        break
    else
        echo "Falha ao baixar de ${SOURCE_NAME}"
        rm -f /opt/wav2lip/checkpoints/wav2lip_gan.pth
    fi
done

if [ "${WAV2LIP_DOWNLOADED}" != "true" ]; then
    echo "::error::Download de wav2lip_gan.pth falhou de todas as fontes"
    echo "::error::Configure HUGGINGFACE_TOKEN no GitHub Secrets (read-only token do HuggingFace) para acesso confiável"
    exit 1
fi

# Validar tamanho (~400MB = 400000000 bytes)
WAV2LIP_SIZE=$(stat -c%s /opt/wav2lip/checkpoints/wav2lip_gan.pth 2>/dev/null || stat -f%z /opt/wav2lip/checkpoints/wav2lip_gan.pth 2>/dev/null || echo "0")
if [ "${WAV2LIP_SIZE}" -lt 400000000 ]; then
    echo "::error::wav2lip_gan.pth corrompido (tamanho: ${WAV2LIP_SIZE} bytes, esperado: ~400MB)"
    exit 1
fi

# Validar checksum
if [ -z "${WAV2LIP_CHECKPOINT_SHA256}" ]; then
    echo "::error::WAV2LIP_CHECKPOINT_SHA256 é obrigatório"
    exit 1
fi
echo "${WAV2LIP_CHECKPOINT_SHA256}  /opt/wav2lip/checkpoints/wav2lip_gan.pth" | sha256sum -c -
echo "wav2lip_gan.pth validado com sucesso"

echo "=== Baixando s3fd.pth ==="

S3FD_SOURCES=(
    "https://huggingface.co/gmk123/wav2lip/resolve/main/s3fd-619a316812.pth|gmk123/wav2lip"
    "https://huggingface.co/spaces/manavisrani07/gradio-lipsync-wav2lip/resolve/main/face_detection/detection/sfd/s3fd.pth|manavisrani07/gradio-lipsync-wav2lip"
    "https://huggingface.co/camenduru/Wav2Lip/resolve/main/checkpoints/s3fd-619a316812.pth|camenduru/Wav2Lip"
)

S3FD_DOWNLOADED=false
for SOURCE in "${S3FD_SOURCES[@]}"; do
    S3FD_URL=$(echo "${SOURCE}" | cut -d'|' -f1)
    SOURCE_NAME=$(echo "${SOURCE}" | cut -d'|' -f2)
    
    echo "Tentando baixar s3fd.pth de ${SOURCE_NAME}..."
    if download_with_token "${S3FD_URL}" /opt/wav2lip/face_detection/detection/sfd/s3fd.pth; then
        echo "Download bem-sucedido de ${SOURCE_NAME}"
        S3FD_DOWNLOADED=true
        break
    else
        echo "Falha ao baixar de ${SOURCE_NAME}"
        rm -f /opt/wav2lip/face_detection/detection/sfd/s3fd.pth
    fi
done

if [ "${S3FD_DOWNLOADED}" != "true" ]; then
    echo "::error::Download de s3fd.pth falhou de todas as fontes"
    echo "::error::Configure HUGGINGFACE_TOKEN no GitHub Secrets (read-only token do HuggingFace) para acesso confiável"
    exit 1
fi

# Validar tamanho (~85MB = 89128960 bytes)
S3FD_SIZE=$(stat -c%s /opt/wav2lip/face_detection/detection/sfd/s3fd.pth 2>/dev/null || stat -f%z /opt/wav2lip/face_detection/detection/sfd/s3fd.pth 2>/dev/null || echo "0")
if [ "${S3FD_SIZE}" -lt 89128960 ]; then
    echo "::error::s3fd.pth corrompido (tamanho: ${S3FD_SIZE} bytes, esperado: ~85MB)"
    exit 1
fi

# Validar checksum
if [ -z "${S3FD_SHA256}" ]; then
    echo "::error::S3FD_SHA256 é obrigatório"
    exit 1
fi
echo "${S3FD_SHA256}  /opt/wav2lip/face_detection/detection/sfd/s3fd.pth" | sha256sum -c -
echo "s3fd.pth validado com sucesso"

echo "=== Todos os modelos baixados e validados com sucesso ==="
