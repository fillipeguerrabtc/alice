#!/usr/bin/env bash
set -euo pipefail

PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
OUTPUT_DIR=""

usage() {
  cat <<'EOF'
Usage: validate-slo-burn-rates.sh [--prometheus-url <url>] [--output-dir <dir>]

Examples:
  bash infra/scripts/validate-slo-burn-rates.sh
  bash infra/scripts/validate-slo-burn-rates.sh --prometheus-url https://metrics.yesyoudeserve.duckdns.org
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prometheus-url)
      PROMETHEUS_URL="${2:-}"
      shift 2
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
  OUTPUT_DIR="tmp/slo-burn-rate-validation-${TIMESTAMP}"
fi
mkdir -p "$OUTPUT_DIR"

query() {
  local name="$1"
  local promql="$2"
  curl -sS --get \
    --data-urlencode "query=${promql}" \
    "${PROMETHEUS_URL}/api/v1/query" \
    > "${OUTPUT_DIR}/${name}.json"
}

echo "== SLO Burn Rate Validation =="
echo "Prometheus URL: ${PROMETHEUS_URL}"
echo "Output: ${OUTPUT_DIR}"
echo ""

query "01-slo-burn-rate-all" "alice_slo_burn_rate"
query "02-slo-burn-rate-chat-stream" "alice_slo_burn_rate{journey=\"chat-stream\"}"
query "03-slo-burn-rate-trading-signal" "alice_slo_burn_rate{journey=\"trading-signal\"}"
query "04-slo-burn-rate-training-queue" "alice_slo_burn_rate{journey=\"training-queue\"}"
query "05-slo-burn-rate-rag-ingest" "alice_slo_burn_rate{journey=\"rag-ingest\"}"
query "06-queue-lag-seconds" "alice_queue_lag_seconds"

echo "Validation finished."
echo "Evidence directory: ${OUTPUT_DIR}"
