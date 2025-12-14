#!/bin/bash
# Script para configurar repositório Wav2Lip
# Enterprise-grade: commit fixo para reprodutibilidade
# Autor: Fillipe Guerra
# Data: 13/12/2025

set -euo pipefail

# Commit fixo para reprodutibilidade enterprise (builds determinísticos)
# Commit: bac9a81e63ecc153202353372e5724b83d9e6322 (HEAD do master, 13/12/2025)
# NOTA: Se este commit não existir mais, atualizar para commit mais recente do master
WAV2LIP_COMMIT="bac9a81e63ecc153202353372e5724b83d9e6322"

echo "Clonando repositório Wav2Lip..."
git clone --branch master --no-single-branch https://github.com/Rudrabha/Wav2Lip.git /opt/wav2lip

cd /opt/wav2lip

echo "Configurando Git LFS..."
git lfs install --local

# Verificar se commit existe localmente (deve existir após clone completo do master)
if git cat-file -e "${WAV2LIP_COMMIT}^{commit}" 2>/dev/null; then
    echo "Usando commit fixo: ${WAV2LIP_COMMIT}"
    git checkout "${WAV2LIP_COMMIT}"
else
    echo "::error::Commit fixo não encontrado: ${WAV2LIP_COMMIT}"
    echo "::error::Branches disponíveis:"
    git branch -r 2>/dev/null | head -n 5 || echo "  (não disponível)"
    echo "::error::Último commit do master:"
    git rev-parse origin/master 2>/dev/null || git rev-parse HEAD 2>/dev/null || echo "  (não disponível)"
    echo "::error::Atualize WAV2LIP_COMMIT no script para commit válido do master"
    echo "::error::Build falhou - commit fixo é obrigatório para reprodutibilidade enterprise (Regra 6)"
    exit 1
fi

echo "Baixando arquivos LFS..."
git lfs fetch --all
git lfs pull

# NOTA: NÃO instalamos requirements.txt do Wav2Lip porque:
# 1. O requirements.txt do repositório tem versões antigas (opencv-python==4.1.0.25) que não existem mais no PyPI
# 2. Já instalamos nossas próprias dependências compatíveis no Dockerfile (docker/lip-sync/requirements.txt)
# 3. Evita conflitos de versões entre dependências
echo "Pulando instalação de requirements.txt do Wav2Lip (usando dependências do container)"

echo "Repositório Wav2Lip configurado com sucesso"
