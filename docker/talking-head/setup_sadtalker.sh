#!/bin/bash
# Script para configurar repositório SadTalker e baixar modelos
# Enterprise-grade: download manual com URLs diretas (evita loops infinitos)
# Autor: Fillipe Guerra
# Data: 13/12/2025

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

# Download manual dos modelos com URLs diretas do GitHub Releases
# Enterprise-grade: URLs estáveis do GitHub Releases (não precisa de autenticação)
# Fonte: https://github.com/OpenTalker/SadTalker/releases/tag/v0.0.2
# wget options conforme documentação oficial:
# --timeout=300: timeout de conexão de 5 minutos
# --tries=5: 5 tentativas
# --waitretry=10: espera 10 segundos entre tentativas
# --retry-connrefused: retry em conexão recusada
# --show-progress: mostra progresso do download

SADTALKER_RELEASE="https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2"
WGET_OPTS="--timeout=300 --tries=5 --waitretry=10 --retry-connrefused --show-progress"

echo "=== Baixando modelos principais (checkpoints/) ==="

# MappingNet Models
echo "Baixando mapping_00109-model.pth.tar..."
wget ${WGET_OPTS} -O checkpoints/mapping_00109-model.pth.tar \
    "${SADTALKER_RELEASE}/mapping_00109-model.pth.tar"

echo "Baixando mapping_00229-model.pth.tar..."
wget ${WGET_OPTS} -O checkpoints/mapping_00229-model.pth.tar \
    "${SADTALKER_RELEASE}/mapping_00229-model.pth.tar"

# SadTalker Checkpoints (safetensors - formato mais recente)
echo "Baixando SadTalker_V0.0.2_256.safetensors..."
wget ${WGET_OPTS} -O checkpoints/SadTalker_V0.0.2_256.safetensors \
    "${SADTALKER_RELEASE}/SadTalker_V0.0.2_256.safetensors"

echo "Baixando SadTalker_V0.0.2_512.safetensors..."
wget ${WGET_OPTS} -O checkpoints/SadTalker_V0.0.2_512.safetensors \
    "${SADTALKER_RELEASE}/SadTalker_V0.0.2_512.safetensors"

echo "=== Baixando modelos de enhancement (gfpgan/weights/) ==="

# Face Alignment Model
echo "Baixando alignment_WFLW_4HG.pth..."
wget ${WGET_OPTS} -O gfpgan/weights/alignment_WFLW_4HG.pth \
    "${SADTALKER_RELEASE}/alignment_WFLW_4HG.pth"

# Face Detection Model
echo "Baixando detection_Resnet50_Final.pth..."
wget ${WGET_OPTS} -O gfpgan/weights/detection_Resnet50_Final.pth \
    "${SADTALKER_RELEASE}/detection_Resnet50_Final.pth"

# GFPGAN Model
echo "Baixando GFPGANv1.4.pth..."
wget ${WGET_OPTS} -O gfpgan/weights/GFPGANv1.4.pth \
    "${SADTALKER_RELEASE}/GFPGANv1.4.pth"

# Face Parsing Model
echo "Baixando parsing_parsenet.pth..."
wget ${WGET_OPTS} -O gfpgan/weights/parsing_parsenet.pth \
    "${SADTALKER_RELEASE}/parsing_parsenet.pth"

echo "=== Validando downloads ==="

# Validação enterprise: verificar se checkpoints foram baixados corretamente
if [ ! -d checkpoints ] || [ -z "$(ls -A checkpoints 2>/dev/null)" ]; then
    echo "::error::Diretório checkpoints vazio ou ausente após download"
    echo "::error::Conteúdo atual do diretório:"
    ls -la checkpoints/ 2>/dev/null || echo "  (diretório não existe)"
    exit 1
fi

# Contar arquivos de checkpoint
# Enterprise-grade: validar contagem EXATA (2 safetensors + 2 pth.tar = 4 total)
SAFETENSORS_COUNT=$(find checkpoints -type f -name "*.safetensors" 2>/dev/null | wc -l)
PTHTAR_COUNT=$(find checkpoints -type f -name "*.pth.tar" 2>/dev/null | wc -l)
CHECKPOINT_FILES=$((SAFETENSORS_COUNT + PTHTAR_COUNT))

# Validar contagem exata: 2 safetensors + 2 pth.tar = 4 arquivos
if [ "${SAFETENSORS_COUNT}" -ne 2 ]; then
    echo "::error::Esperado 2 arquivos safetensors, encontrado ${SAFETENSORS_COUNT}"
    echo "::error::Arquivos esperados: SadTalker_V0.0.2_256.safetensors, SadTalker_V0.0.2_512.safetensors"
    echo "::error::Conteúdo atual de checkpoints/:"
    ls -la checkpoints/ 2>/dev/null || echo "  (diretório não existe)"
    exit 1
fi

if [ "${PTHTAR_COUNT}" -ne 2 ]; then
    echo "::error::Esperado 2 arquivos pth.tar, encontrado ${PTHTAR_COUNT}"
    echo "::error::Arquivos esperados: mapping_00109-model.pth.tar, mapping_00229-model.pth.tar"
    echo "::error::Conteúdo atual de checkpoints/:"
    ls -la checkpoints/ 2>/dev/null || echo "  (diretório não existe)"
    exit 1
fi

# Verificar arquivos gfpgan
# Enterprise-grade: validar contagem EXATA (4 arquivos pth)
GFPGAN_COUNT=$(find gfpgan/weights -type f -name "*.pth" 2>/dev/null | wc -l)
if [ "${GFPGAN_COUNT}" -ne 4 ]; then
    echo "::error::Esperado 4 arquivos GFPGAN, encontrado ${GFPGAN_COUNT}"
    echo "::error::Arquivos esperados: alignment_WFLW_4HG.pth, detection_Resnet50_Final.pth, GFPGANv1.4.pth, parsing_parsenet.pth"
    echo "::error::Conteúdo atual de gfpgan/weights/:"
    ls -la gfpgan/weights/ 2>/dev/null || echo "  (diretório não existe)"
    exit 1
fi

# Calcular total de arquivos baixados
TOTAL_FILES=$((CHECKPOINT_FILES + GFPGAN_COUNT))

echo "=== Modelos SadTalker baixados com sucesso ==="
echo "  - Checkpoints: ${CHECKPOINT_FILES} arquivos (2 safetensors + 2 pth.tar)"
echo "  - GFPGAN weights: ${GFPGAN_COUNT} arquivos"
echo "  - Total: ${TOTAL_FILES} arquivos"
