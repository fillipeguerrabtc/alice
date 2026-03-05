#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3007}"
BACKUP_ID="${BACKUP_ID:-}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
EXECUTE_RESTORE="false"
OUTPUT_DIR=""

usage() {
  cat <<'EOF'
Usage: run-dr-game-day.sh --backup-id <id> [--base-url <url>] [--auth-token <token>] [--execute-restore] [--output-dir <dir>]

Examples:
  bash infra/scripts/run-dr-game-day.sh --backup-id backup-20260305-030000
  bash infra/scripts/run-dr-game-day.sh --backup-id backup-20260305-030000 --base-url https://observability.yesyoudeserve.duckdns.org --auth-token "$ADMIN_BEARER_TOKEN"
  bash infra/scripts/run-dr-game-day.sh --backup-id backup-20260305-030000 --execute-restore
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-id)
      BACKUP_ID="${2:-}"
      shift 2
      ;;
    --base-url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    --auth-token)
      AUTH_TOKEN="${2:-}"
      shift 2
      ;;
    --execute-restore)
      EXECUTE_RESTORE="true"
      shift
      ;;
    --output-dir)
      OUTPUT_DIR="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$BACKUP_ID" ]]; then
  echo "ERROR: --backup-id is required"
  usage
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl not found"
  exit 1
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="tmp/dr-game-day-${TIMESTAMP}"
fi
mkdir -p "$OUTPUT_DIR"

HEADER_ARGS=(-H "Content-Type: application/json")
if [[ -n "$AUTH_TOKEN" ]]; then
  HEADER_ARGS+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
fi

echo "== DR Game Day =="
echo "Base URL: ${BASE_URL}"
echo "Backup ID: ${BACKUP_ID}"
echo "Output: ${OUTPUT_DIR}"
echo ""

echo "[1/4] Capturing backup status baseline..."
curl -sS "${HEADER_ARGS[@]}" \
  "${BASE_URL}/api/backup/status" \
  > "${OUTPUT_DIR}/01-backup-status.json"

echo "[2/4] Capturing backup history snapshot..."
curl -sS "${HEADER_ARGS[@]}" \
  "${BASE_URL}/api/backup/history" \
  > "${OUTPUT_DIR}/02-backup-history.json"

echo "[3/4] Executing restore dry-run..."
curl -sS "${HEADER_ARGS[@]}" \
  -X POST "${BASE_URL}/api/backup/restore" \
  -d "{\"backupId\":\"${BACKUP_ID}\",\"dryRun\":true,\"confirm\":true}" \
  > "${OUTPUT_DIR}/03-restore-dry-run.json"

if [[ "$EXECUTE_RESTORE" == "true" ]]; then
  echo "[4/4] Executing real restore (confirm=true)..."
  curl -sS "${HEADER_ARGS[@]}" \
    -X POST "${BASE_URL}/api/backup/restore" \
    -d "{\"backupId\":\"${BACKUP_ID}\",\"dryRun\":false,\"confirm\":true}" \
    > "${OUTPUT_DIR}/04-restore-execution.json"
else
  echo "[4/4] Real restore skipped (pass --execute-restore to run)."
fi

echo ""
echo "DR Game Day evidence collected in: ${OUTPUT_DIR}"
