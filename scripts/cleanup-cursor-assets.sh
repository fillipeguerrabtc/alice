#!/bin/bash
# ==============================================================================
# Script de Limpeza - Cursor IDE Assets
# Alice Enterprise Platform
#
# Remove arquivos temporários do Cursor IDE (attached_assets/)
# Pode ser executado manualmente ou via cron (diário)
#
# Autor: Fillipe Guerra
# Data: 11 de Dezembro de 2025
# ==============================================================================

set -e

# Caminho do projeto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ATTACHED_ASSETS_PATH="$PROJECT_ROOT/attached_assets"

echo "============================================"
echo " Limpeza de Assets Temporários do Cursor"
echo "============================================"
echo ""

if [ -d "$ATTACHED_ASSETS_PATH" ]; then
    # Contar arquivos e calcular tamanho
    TOTAL_FILES=$(find "$ATTACHED_ASSETS_PATH" -type f | wc -l)
    TOTAL_SIZE=$(du -sh "$ATTACHED_ASSETS_PATH" 2>/dev/null | cut -f1)

    echo "Pasta encontrada: $ATTACHED_ASSETS_PATH"
    echo "Arquivos: $TOTAL_FILES"
    echo "Tamanho: $TOTAL_SIZE"
    echo ""

    # Excluir a pasta
    rm -rf "$ATTACHED_ASSETS_PATH"
    echo "✓ Pasta excluída com sucesso!"
    echo "  Liberados: $TOTAL_SIZE ($TOTAL_FILES arquivos)"
else
    echo "✓ Pasta attached_assets/ não existe - nada a limpar."
fi

echo ""
echo "============================================"
echo " Limpeza concluída!"
echo "============================================"

# Para agendar execução diária via cron:
# crontab -e
# Adicionar linha:
# 0 3 * * * /path/to/alice/scripts/cleanup-cursor-assets.sh >> /var/log/alice-cleanup.log 2>&1
