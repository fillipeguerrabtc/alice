#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3004}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
TENANT_ID="${TENANT_ID:-}"
NAMESPACE_ID="${NAMESPACE_ID:-}"
TRIGGER_RUN="false"
OUTPUT_DIR=""

usage() {
  cat <<'EOF'
Usage: validate-gpu-fine-tuning.sh [--base-url <url>] [--auth-token <token>] [--tenant-id <uuid>] [--namespace-id <uuid>] [--trigger-run] [--output-dir <dir>]

Examples:
  bash infra/scripts/validate-gpu-fine-tuning.sh
  bash infra/scripts/validate-gpu-fine-tuning.sh --auth-token "$ADMIN_BEARER_TOKEN" --tenant-id "<tenant-uuid>"
  bash infra/scripts/validate-gpu-fine-tuning.sh --auth-token "$ADMIN_BEARER_TOKEN" --tenant-id "<tenant-uuid>" --namespace-id "<namespace-uuid>" --trigger-run
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    --auth-token)
      AUTH_TOKEN="${2:-}"
      shift 2
      ;;
    --tenant-id)
      TENANT_ID="${2:-}"
      shift 2
      ;;
    --namespace-id)
      NAMESPACE_ID="${2:-}"
      shift 2
      ;;
    --trigger-run)
      TRIGGER_RUN="true"
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

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl not found"
  exit 1
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="tmp/training-gpu-validation-${TIMESTAMP}"
fi
mkdir -p "$OUTPUT_DIR"

HEADER_ARGS=(-H "Content-Type: application/json")
if [[ -n "$AUTH_TOKEN" ]]; then
  HEADER_ARGS+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
fi

echo "== GPU Fine-Tuning Validation =="
echo "Base URL: ${BASE_URL}"
echo "Output: ${OUTPUT_DIR}"
echo ""

echo "[1/5] Health check..."
curl -sS "${BASE_URL}/api/training/health" > "${OUTPUT_DIR}/01-health.json"

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "[2/5] Skipping protected checks (auth token not provided)."
  echo "Validation finished with public health only."
  echo "Evidence directory: ${OUTPUT_DIR}"
  exit 0
fi

QUEUE_STATUS_URL="${BASE_URL}/api/training/queue/status"
RUN_STATUS_URL="${BASE_URL}/api/training/run/status"
if [[ -n "$TENANT_ID" ]]; then
  QUEUE_STATUS_URL="${QUEUE_STATUS_URL}?tenantId=${TENANT_ID}"
  RUN_STATUS_URL="${RUN_STATUS_URL}?tenantId=${TENANT_ID}"
fi

echo "[2/5] Queue status..."
curl -sS "${HEADER_ARGS[@]}" "${QUEUE_STATUS_URL}" > "${OUTPUT_DIR}/02-queue-status.json"

echo "[3/5] GPU orchestrator state..."
curl -sS "${HEADER_ARGS[@]}" "${BASE_URL}/api/training/gpu-orchestrator/state" > "${OUTPUT_DIR}/03-gpu-orchestrator-state.json"

echo "[4/5] Current run status..."
curl -sS "${HEADER_ARGS[@]}" "${RUN_STATUS_URL}" > "${OUTPUT_DIR}/04-run-status.json"

if [[ "$TRIGGER_RUN" != "true" ]]; then
  echo "[5/5] On-demand trigger skipped (pass --trigger-run to execute)."
  echo "Validation finished."
  echo "Evidence directory: ${OUTPUT_DIR}"
  exit 0
fi

if [[ -z "$TENANT_ID" ]]; then
  echo "ERROR: --trigger-run requires --tenant-id"
  exit 1
fi

IDEMPOTENCY_KEY="gpu-validation-${TIMESTAMP}"
BODY="{\"tenantId\":\"${TENANT_ID}\",\"trainingType\":\"incremental\",\"includeImages\":false,\"priority\":\"low\",\"description\":\"GPU validation run ${TIMESTAMP}\""
if [[ -n "$NAMESPACE_ID" ]]; then
  BODY="${BODY},\"namespaceId\":\"${NAMESPACE_ID}\""
fi
BODY="${BODY}}"

echo "[5/5] Triggering on-demand fine-tuning run..."
curl -sS "${HEADER_ARGS[@]}" \
  -H "X-Idempotency-Key: ${IDEMPOTENCY_KEY}" \
  -X POST "${BASE_URL}/api/training/run/start" \
  -d "${BODY}" \
  > "${OUTPUT_DIR}/05-run-start.json"

echo "Validation finished."
echo "Evidence directory: ${OUTPUT_DIR}"
