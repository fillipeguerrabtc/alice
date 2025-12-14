#!/bin/bash
# Script para configurar repositório SadTalker e baixar modelos
# Enterprise-grade: timeout e validação robusta
# Autor: Fillipe Guerra
# Data: 13/12/2025

set -euo pipefail

echo "Clonando repositório SadTalker..."
git clone https://github.com/OpenTalker/SadTalker.git /opt/sadtalker

cd /opt/sadtalker

echo "Instalando dependências Python..."
python3 -m pip install --no-cache-dir -r requirements.txt

# Verificar se script de download existe
if [ ! -f scripts/download_models.sh ]; then
    echo "::error::scripts/download_models.sh não encontrado no repositório SadTalker"
    exit 1
fi

chmod +x scripts/download_models.sh

# Modificar script para adicionar timeout aos wget (evitar loops infinitos)
echo "Configurando timeout para downloads..."
sed -i -E 's|wget([[:space:]]+)-nc|wget\1--timeout=300 --tries=3 -nc|g' scripts/download_models.sh 2>/dev/null || true
sed -i -E 's|wget([[:space:]]+)--no-check-certificate|wget\1--timeout=300 --tries=3 --no-check-certificate|g' scripts/download_models.sh 2>/dev/null || true

# Timeout de 45 minutos (2700s) para evitar loops infinitos
# Downloads podem ser grandes (~1GB+)
echo "Baixando modelos SadTalker (timeout: 45 minutos)..."
if ! timeout 2700 bash scripts/download_models.sh; then
    EXIT_CODE=$?
    if [ ${EXIT_CODE} -eq 124 ]; then
        echo "::error::Download de modelos SadTalker excedeu timeout de 45 minutos"
        echo "::error::Possível loop infinito ou download muito lento - verifique logs acima"
    else
        echo "::error::Download de modelos SadTalker falhou (código: ${EXIT_CODE})"
        echo "::error::Verifique logs acima para identificar qual download falhou"
    fi
    exit 1
fi

# Validação enterprise: verificar se checkpoints foram baixados corretamente
if [ ! -d checkpoints ] || [ -z "$(ls -A checkpoints 2>/dev/null)" ]; then
    echo "::error::Diretório checkpoints vazio ou ausente após download"
    exit 1
fi

# Contar arquivos de checkpoint
SAFETENSORS_COUNT=$(find checkpoints -type f -name "*.safetensors" 2>/dev/null | wc -l)
PTHTAR_COUNT=$(find checkpoints -type f -name "*.pth.tar" 2>/dev/null | wc -l)
PTH_COUNT=$(find checkpoints -type f -name "*.pth" ! -name "*.pth.tar" 2>/dev/null | wc -l)
CHECKPOINT_FILES=$((SAFETENSORS_COUNT + PTHTAR_COUNT + PTH_COUNT))

if [ "${CHECKPOINT_FILES}" -eq 0 ]; then
    echo "::error::Nenhum arquivo de checkpoint encontrado em checkpoints/ após download"
    echo "::error::Arquivos esperados: *.safetensors, *.pth.tar ou *.pth"
    exit 1
fi

echo "Modelos SadTalker baixados com sucesso (${CHECKPOINT_FILES} arquivos encontrados)"
