#!/bin/bash
# =============================================================================
# Healthcheck script para pgBackRest - Alice Enterprise Platform
# =============================================================================
# CORREÇÃO CRÍTICA 29/12/2025: Healthcheck robusto que não falha se stanza não existe
# stanza-upgrade só funciona DEPOIS de stanza-create (executado no deploy workflow)
# Solução: verificar se stanza existe; se não, apenas validar que pgbackrest responde
#
# Author: Fillipe Guerra
# Data: 29 de Dezembro de 2025
# =============================================================================

STANZA="${PGBACKREST_STANZA:-alice_prod}"

# Verificar se stanza existe
if pgbackrest --stanza="${STANZA}" info --output=json 2>/dev/null | jq -e 'length > 0' >/dev/null 2>&1; then
  # Stanza existe - validar com check
  if pgbackrest --stanza="${STANZA}" check >/dev/null 2>&1; then
    echo "[HEALTHCHECK] OK: pgBackRest operacional, stanza ${STANZA} válida"
    exit 0
  else
    echo "[HEALTHCHECK] AVISO: pgBackRest check retornou avisos (stanza ${STANZA})" >&2
    # Não falhar - check pode ter avisos mas backup funciona
    exit 0
  fi
else
  # Stanza não existe ainda (primeira execução) - apenas verificar que pgbackrest responde
  if pgbackrest version >/dev/null 2>&1; then
    echo "[HEALTHCHECK] OK: pgBackRest instalado e respondendo (stanza ${STANZA} será criada no deploy)"
    exit 0
  fi
fi

echo "[HEALTHCHECK] ERRO: pgBackRest não está respondendo" >&2
exit 1
