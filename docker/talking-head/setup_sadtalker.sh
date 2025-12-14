#!/bin/bash
# Script para configurar repositório SadTalker e baixar modelos
# Enterprise-grade: download manual com URLs diretas (evita loops infinitos)
# Autor: Fillipe Guerra
# Data: 14/12/2025

set -euo pipefail

echo "Clonando repositório SadTalker..."
git clone https://github.com/OpenTalker/SadTalker.git /opt/sadtalker

cd /opt/sadtalker

# NOTA: NÃO instalamos requirements.txt do SadTalker porque:
# 1. O requirements.txt do repositório pode ter versões antigas ou incompatíveis
# 2. Já instalamos nossas próprias dependências compatíveis no Dockerfile
# 3. Evita conflitos de versões entre dependências
echo "Pulando instalação de requirements.txt do SadTalker (usando dependências do container)"

# Criar diretórios para modelos
echo "Criando diretórios para modelos..."
mkdir -p checkpoints
mkdir -p gfpgan/weights

# Download manual dos modelos
# Enterprise-grade: HuggingFace mirrors (GitHub Releases v0.0.2 retorna 404 para alguns arquivos)
# Fontes: HuggingFace (camenduru/SadTalker - público, sem autenticação)
# wget options conforme documentação oficial (gnu.org/software/wget/manual):
# --connect-timeout=60: timeout de conexão inicial (60 segundos)
# --read-timeout=300: timeout de leitura de dados (5 minutos sem dados = retry)
# --tries=10: 10 tentativas (arquivos grandes podem precisar de mais retries)
# --waitretry=15: espera 15 segundos entre tentativas
# --retry-connrefused: retry em conexão recusada
# --continue: permite resumir downloads interrompidos
# --progress=bar:force: força barra de progresso mesmo em logs

# HuggingFace mirror (público, sem autenticação)
HF_SADTALKER="https://huggingface.co/camenduru/SadTalker/resolve/main/new/checkpoints"
HF_GFPGAN="https://huggingface.co/camenduru/SadTalker/resolve/main/new/gfpgan/weights"
WGET_OPTS="--connect-timeout=60 --read-timeout=300 --tries=10 --waitretry=15 --retry-connrefused --continue --progress=bar:force"

echo "=== Baixando modelos principais (checkpoints/) ==="
echo "Fonte: HuggingFace (camenduru/SadTalker)"

# MappingNet Models
echo "Baixando mapping_00109-model.pth.tar..."
wget ${WGET_OPTS} -O checkpoints/mapping_00109-model.pth.tar \
    "${HF_SADTALKER}/mapping_00109-model.pth.tar"

echo "Baixando mapping_00229-model.pth.tar..."
wget ${WGET_OPTS} -O checkpoints/mapping_00229-model.pth.tar \
    "${HF_SADTALKER}/mapping_00229-model.pth.tar"

# SadTalker Checkpoints (safetensors - formato mais recente)
echo "Baixando SadTalker_V0.0.2_256.safetensors..."
wget ${WGET_OPTS} -O checkpoints/SadTalker_V0.0.2_256.safetensors \
    "${HF_SADTALKER}/SadTalker_V0.0.2_256.safetensors"

echo "Baixando SadTalker_V0.0.2_512.safetensors..."
wget ${WGET_OPTS} -O checkpoints/SadTalker_V0.0.2_512.safetensors \
    "${HF_SADTALKER}/SadTalker_V0.0.2_512.safetensors"

echo "=== Baixando modelos de enhancement (gfpgan/weights/) ==="

# Face Alignment Model
echo "Baixando alignment_WFLW_4HG.pth..."
wget ${WGET_OPTS} -O gfpgan/weights/alignment_WFLW_4HG.pth \
    "${HF_GFPGAN}/alignment_WFLW_4HG.pth"

# Face Detection Model
echo "Baixando detection_Resnet50_Final.pth..."
wget ${WGET_OPTS} -O gfpgan/weights/detection_Resnet50_Final.pth \
    "${HF_GFPGAN}/detection_Resnet50_Final.pth"

# GFPGAN Model
echo "Baixando GFPGANv1.4.pth..."
wget ${WGET_OPTS} -O gfpgan/weights/GFPGANv1.4.pth \
    "${HF_GFPGAN}/GFPGANv1.4.pth"

# Face Parsing Model
echo "Baixando parsing_parsenet.pth..."
wget ${WGET_OPTS} -O gfpgan/weights/parsing_parsenet.pth \
    "${HF_GFPGAN}/parsing_parsenet.pth"

echo "=== Validando downloads ==="

# Validação enterprise: verificar existência de cada arquivo específico
# Mais robusto que contagem por extensão (evita falsos positivos/negativos)

CHECKPOINT_FILES=0
GFPGAN_FILES=0

echo "Verificando arquivos de checkpoint..."

# Verificar cada arquivo específico de checkpoint
for FILE in \
    "checkpoints/mapping_00109-model.pth.tar" \
    "checkpoints/mapping_00229-model.pth.tar" \
    "checkpoints/SadTalker_V0.0.2_256.safetensors" \
    "checkpoints/SadTalker_V0.0.2_512.safetensors"; do
    if [ -f "${FILE}" ] && [ -s "${FILE}" ]; then
        echo "  OK: ${FILE}"
        CHECKPOINT_FILES=$((CHECKPOINT_FILES + 1))
    else
        echo "::error::Arquivo ausente ou vazio: ${FILE}"
        ls -la "$(dirname "${FILE}")/" 2>/dev/null || echo "  (diretório não existe)"
        exit 1
    fi
done

echo "Verificando arquivos GFPGAN..."

# Verificar cada arquivo específico de GFPGAN
for FILE in \
    "gfpgan/weights/alignment_WFLW_4HG.pth" \
    "gfpgan/weights/detection_Resnet50_Final.pth" \
    "gfpgan/weights/GFPGANv1.4.pth" \
    "gfpgan/weights/parsing_parsenet.pth"; do
    if [ -f "${FILE}" ] && [ -s "${FILE}" ]; then
        echo "  OK: ${FILE}"
        GFPGAN_FILES=$((GFPGAN_FILES + 1))
    else
        echo "::error::Arquivo ausente ou vazio: ${FILE}"
        ls -la "$(dirname "${FILE}")/" 2>/dev/null || echo "  (diretório não existe)"
        exit 1
    fi
done

# Calcular total de arquivos baixados
TOTAL_FILES=$((CHECKPOINT_FILES + GFPGAN_FILES))

echo "=== Modelos SadTalker baixados com sucesso ==="
echo "  - Checkpoints: ${CHECKPOINT_FILES} arquivos (2 safetensors + 2 pth.tar)"
echo "  - GFPGAN weights: ${GFPGAN_FILES} arquivos"
echo "  - Total: ${TOTAL_FILES} arquivos"
