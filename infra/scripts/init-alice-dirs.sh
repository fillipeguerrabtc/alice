#!/bin/bash
# =============================================================================
# Script de Inicialização de Diretórios - Alice Enterprise Platform
# =============================================================================
# Cria estrutura completa de diretórios com permissões enterprise-grade
# Executado no primeiro deploy e após atualizações de estrutura
#
# Estrutura (ATUALIZADO 23/12/2025 - Vídeo removido):
# /opt/alice/
# ├── data/          (750) - Dados de DBs e serviços
# ├── uploads/       (750) - Uploads multimodais (subpastas por tipo)
# │   ├── tts/       (750) - Outputs de jobs TTS
# │   └── media/     (750) - Outros arquivos multimodais
# ├── backups/       (750) - Backups enterprise
# │   ├── postgresql/ (750)
# │   ├── mariadb/   (750)
# │   ├── redis/     (750)
# │   └── manifests/ (750)
# └── logs/          (750) - Logs de serviços
#
# Permissões:
# - Diretórios: 750 (rwxr-x---) - owner/group rwx, outros sem acesso
# - Secrets: 600 (rw-------) - apenas owner
#
# Autor: Fillipe Guerra
# Data: 13 de Dezembro de 2025
# =============================================================================

set -euo pipefail

BASE_DIR="/opt/alice"
OWNER_USER="${ALICE_OWNER_USER:-root}"
OWNER_GROUP="${ALICE_OWNER_GROUP:-root}"

echo "=================================================="
echo "  Inicializando estrutura de diretórios Alice"
echo "  Base: ${BASE_DIR}"
echo "=================================================="

# Criar estrutura base
# ATUALIZADO 23/12/2025: Removidos diretórios de vídeo (lip-sync, talking-head, long-video)
echo "[INFO] Criando diretórios base..."
mkdir -p "${BASE_DIR}/data"
mkdir -p "${BASE_DIR}/uploads/tts"
mkdir -p "${BASE_DIR}/uploads/media"
mkdir -p "${BASE_DIR}/backups/postgresql"
mkdir -p "${BASE_DIR}/backups/postgresql/logs"
mkdir -p "${BASE_DIR}/backups/mariadb"
mkdir -p "${BASE_DIR}/backups/redis"
mkdir -p "${BASE_DIR}/backups/manifests"
mkdir -p "${BASE_DIR}/logs"

# Aplicar permissões enterprise (750 para diretórios)
echo "[INFO] Aplicando permissões enterprise..."
chown -R "${OWNER_USER}:${OWNER_GROUP}" "${BASE_DIR}"
chmod 750 "${BASE_DIR}"
find "${BASE_DIR}" -type d -exec chmod 750 {} \;
find "${BASE_DIR}" -type f -exec chmod 640 {} \;

# Secrets: permissões mais restritivas (600)
if [ -d "${BASE_DIR}/secrets" ]; then
    echo "[INFO] Aplicando permissões restritivas em secrets..."
    find "${BASE_DIR}/secrets" -type f -exec chmod 600 {} \;
    find "${BASE_DIR}/secrets" -type d -exec chmod 700 {} \;
fi

echo "[OK] Estrutura de diretórios inicializada com sucesso!"
echo "=================================================="
