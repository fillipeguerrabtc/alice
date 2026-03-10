#!/usr/bin/env bash
set -euo pipefail

# Guardrail operacional para evitar regressão de foco/churn/fragmentação.
# Author: Fillipe Guerra
# Data: 10 de Março de 2026

WINDOW="${1:-200}"
ENFORCE_FAILURE="${ENFORCE_FAILURE:-false}"

DOC_TOUCH_THRESHOLD_PCT="${DOC_TOUCH_THRESHOLD_PCT:-45}"
WISE_COMMIT_THRESHOLD_PCT="${WISE_COMMIT_THRESHOLD_PCT:-40}"
WISE_FILES_THRESHOLD="${WISE_FILES_THRESHOLD:-190}"
WISE_LOC_THRESHOLD="${WISE_LOC_THRESHOLD:-14500}"
TRADING_CONTENT_LINES_THRESHOLD="${TRADING_CONTENT_LINES_THRESHOLD:-1350}"
CHAT_LAYOUT_CONTROLLER_LINES_THRESHOLD="${CHAT_LAYOUT_CONTROLLER_LINES_THRESHOLD:-600}"

if ! [[ "$WINDOW" =~ ^[0-9]+$ ]]; then
  echo "ERRO: janela de commits inválida: '$WINDOW'. Use um inteiro positivo."
  exit 2
fi

if (( WINDOW <= 0 )); then
  echo "ERRO: a janela de commits deve ser maior que zero."
  exit 2
fi

total_commits_available="$(git rev-list --count HEAD)"
if (( total_commits_available == 0 )); then
  echo "ERRO: repositório sem commits."
  exit 2
fi

if (( total_commits_available <= WINDOW )); then
  RANGE="HEAD"
else
  RANGE="HEAD~${WINDOW}..HEAD"
fi

commits_total="$(git log --pretty=format:%s "$RANGE" | sed '/^$/d' | wc -l | tr -d ' ')"
touches_total="$(git log --name-only --pretty=format: "$RANGE" | sed '/^$/d' | wc -l | tr -d ' ')"
doc_touches="$(git log --name-only --pretty=format: "$RANGE" | sed '/^$/d' | grep -E '^(docs/|README\.md$)' || true)"
doc_touches="$(printf '%s\n' "$doc_touches" | sed '/^$/d' | wc -l | tr -d ' ')"

wise_commit_mentions="$(git log --pretty=format:%s "$RANGE" | grep -Ei 'wise' || true)"
wise_commit_mentions="$(printf '%s\n' "$wise_commit_mentions" | sed '/^$/d' | wc -l | tr -d ' ')"

wise_files="$(find apps/frontend-service/src/pages/wise-payments -type f \( -name '*.ts' -o -name '*.tsx' \) | wc -l | tr -d ' ')"
wise_loc="$(find apps/frontend-service/src/pages/wise-payments -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | xargs -0 wc -l | tail -n 1 | awk '{print $1}')"

trading_content_lines="$(wc -l apps/frontend-service/src/pages/TradingContent.tsx | awk '{print $1}')"
chat_layout_controller_lines="$(wc -l apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts | awk '{print $1}')"

doc_touch_pct="0"
if (( touches_total > 0 )); then
  doc_touch_pct="$(awk "BEGIN { printf \"%.2f\", (${doc_touches} * 100) / ${touches_total} }")"
fi

wise_commit_pct="0"
if (( commits_total > 0 )); then
  wise_commit_pct="$(awk "BEGIN { printf \"%.2f\", (${wise_commit_mentions} * 100) / ${commits_total} }")"
fi

echo "Janela analisada: ${RANGE}"
echo "Commits na janela: ${commits_total}"
echo "Touches totais: ${touches_total}"
echo "Touches docs+README: ${doc_touches} (${doc_touch_pct}%)"
echo "Commits com foco Wise: ${wise_commit_mentions} (${wise_commit_pct}%)"
echo "Wise files (TS/TSX): ${wise_files}"
echo "Wise LOC (TS/TSX): ${wise_loc}"
echo "TradingContent.tsx linhas: ${trading_content_lines}"
echo "useChatPageLayoutController.ts linhas: ${chat_layout_controller_lines}"

failed=0

check_pct_lte() {
  local value="$1"
  local threshold="$2"
  local label="$3"
  if awk "BEGIN { exit !($value <= $threshold) }"; then
    echo "OK   - ${label}: ${value}% <= ${threshold}%"
  else
    echo "FAIL - ${label}: ${value}% > ${threshold}%"
    failed=1
  fi
}

check_lte() {
  local value="$1"
  local threshold="$2"
  local label="$3"
  if (( value <= threshold )); then
    echo "OK   - ${label}: ${value} <= ${threshold}"
  else
    echo "FAIL - ${label}: ${value} > ${threshold}"
    failed=1
  fi
}

check_pct_lte "$doc_touch_pct" "$DOC_TOUCH_THRESHOLD_PCT" "Churn documental"
check_pct_lte "$wise_commit_pct" "$WISE_COMMIT_THRESHOLD_PCT" "Foco desbalanceado no domínio Wise"
check_lte "$wise_files" "$WISE_FILES_THRESHOLD" "Fragmentação de arquivos Wise"
check_lte "$wise_loc" "$WISE_LOC_THRESHOLD" "Densidade total Wise"
check_lte "$trading_content_lines" "$TRADING_CONTENT_LINES_THRESHOLD" "Densidade TradingContent"
check_lte "$chat_layout_controller_lines" "$CHAT_LAYOUT_CONTROLLER_LINES_THRESHOLD" "Densidade Chat layout controller"

if (( failed != 0 )); then
  if [[ "${ENFORCE_FAILURE}" == "true" ]]; then
    echo "Resultado: FAIL (há regressões de governança)."
    exit 1
  fi
  echo "Resultado: WARN (há regressões históricas; monitoramento sem bloqueio nesta execução)."
  exit 0
fi

echo "Resultado: OK (guardrails atendidos)."
