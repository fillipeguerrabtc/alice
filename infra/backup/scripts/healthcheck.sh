#!/bin/bash
# Healthcheck script para pgBackRest
# Usa variável de ambiente PGBACKREST_STANZA (default: alice_prod)
# CORREÇÃO BUG #2: Healthcheck agora usa variável de ambiente configurável

STANZA="${PGBACKREST_STANZA:-alice_prod}"
pgbackrest info --stanza="${STANZA}" --output=json || exit 1
