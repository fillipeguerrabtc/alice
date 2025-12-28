#!/bin/bash
# Healthcheck script para pgBackRest
# Usa variável de ambiente PGBACKREST_STANZA (default: alice_prod)
# CORREÇÃO BUG #2: Healthcheck agora usa variável de ambiente configurável

STANZA="${PGBACKREST_STANZA:-alice_prod}"
# Fail fast se senha do Postgres não estiver definida
if [ -z "${PGPASSWORD:-}" ]; then
  echo "PGPASSWORD não definido; healthcheck pgBackRest falhou" >&2
  exit 1
fi
pgbackrest info --stanza="${STANZA}" --output=json || exit 1
