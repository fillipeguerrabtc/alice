#!/usr/bin/env bash
set -euo pipefail

STACK="all"
ENV_FILE=""
COMPOSE_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack)
      STACK="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --compose-file)
      COMPOSE_FILE="${2:-}"
      shift 2
      ;;
    *)
      echo "Usage: $0 [--stack all|alice|infra|observability|backup] [--env-file .env] [--compose-file docker-compose.yml]"
      exit 1
      ;;
  esac
done

if [[ -n "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: env file not found: $ENV_FILE"
    exit 1
  fi
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

COMMON_SECRETS=(
  POSTGRES_PASSWORD
  REDIS_CACHE_PASSWORD
  REDIS_QUEUE_PASSWORD
  SESSION_SECRET
  INTERNAL_API_SECRET
  QDRANT_API_KEY
)

ALICE_SECRETS=(
  OPENAI_API_KEY
  SEARXNG_SECRET_KEY
  CORS_ORIGIN
)

OBSERVABILITY_SECRETS=(
  GRAFANA_ADMIN_USER
  GRAFANA_ADMIN_PASSWORD
)

BACKUP_SECRETS=(
  BACKUP_CIPHER_PASS
)

required=()
case "$STACK" in
  all)
    required=("${COMMON_SECRETS[@]}" "${ALICE_SECRETS[@]}" "${OBSERVABILITY_SECRETS[@]}" "${BACKUP_SECRETS[@]}")
    ;;
  alice)
    required=("${COMMON_SECRETS[@]}" "${ALICE_SECRETS[@]}")
    ;;
  infra)
    required=("${COMMON_SECRETS[@]}")
    ;;
  observability)
    required=("${COMMON_SECRETS[@]}" "${OBSERVABILITY_SECRETS[@]}")
    ;;
  backup)
    required=("${COMMON_SECRETS[@]}" "${BACKUP_SECRETS[@]}")
    ;;
  *)
    echo "ERROR: invalid stack '$STACK'. Expected all|alice|infra|observability|backup"
    exit 1
    ;;
esac

missing=()
for name in "${required[@]}"; do
  value="${!name-}"
  if [[ -z "${value}" ]]; then
    missing+=("$name")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: missing required secrets for stack '$STACK':"
  for item in "${missing[@]}"; do
    echo "  - $item"
  done
  exit 1
fi

if [[ -n "$COMPOSE_FILE" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker command not found (required for compose preflight)."
    exit 1
  fi

  if [[ -n "$ENV_FILE" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null
  else
    docker compose -f "$COMPOSE_FILE" config >/dev/null
  fi
fi

echo "OK: preflight secrets check passed for stack '$STACK'."
