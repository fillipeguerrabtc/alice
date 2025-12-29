#!/bin/bash
# =============================================================================
# Healthcheck script para pgBackRest - Alice Enterprise Platform
# =============================================================================
# CORREÇÃO 29/12/2025: Healthcheck mais tolerante
# - Verifica se processo está vivo (não se stanza está perfeita)
# - Stanza pode não existir no primeiro deploy
# - archive_mode pode estar off (esperado em Docker)
#
# Author: Fillipe Guerra
# Data: 29 de Dezembro de 2025
# =============================================================================

STANZA="${PGBACKREST_STANZA:-alice_prod}"

# Verificação básica: PGPASSWORD deve estar definido
if [ -z "${PGPASSWORD:-}" ]; then
  echo "[HEALTHCHECK] AVISO: PGPASSWORD não definido" >&2
  # Não falhar - pode estar em fase de inicialização
fi

# Verificar se pgbackrest está acessível e responde
# Usa --output=json para formato parseável
# Se stanza não existe, retorna erro mas container deve continuar

if pgbackrest info --stanza="${STANZA}" --output=json 2>/dev/null; then
  echo "[HEALTHCHECK] OK: pgBackRest operacional, stanza ${STANZA} disponível"
  exit 0
fi

# Se info falhou, verificar se é problema de stanza não criada (esperado no primeiro deploy)
if pgbackrest version >/dev/null 2>&1; then
  echo "[HEALTHCHECK] OK: pgBackRest instalado e respondendo (stanza pode não existir ainda)"
  exit 0
fi

echo "[HEALTHCHECK] ERRO: pgBackRest não está respondendo" >&2
exit 1
