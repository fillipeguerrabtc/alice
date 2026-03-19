#!/usr/bin/env bash
set -euo pipefail

# Guardrail operacional para evitar regressão de foco/churn/fragmentação.
# Author: Fillipe Guerra
# Data: 18 de Março de 2026

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

resolve_historical_range() {
  if (( total_commits_available <= WINDOW )); then
    printf 'HEAD'
    return
  fi

  printf 'HEAD~%s..HEAD' "$WINDOW"
}

is_valid_commit_ref() {
  local ref="$1"
  [[ -n "$ref" ]] && git cat-file -e "${ref}^{commit}" >/dev/null 2>&1
}

resolve_event_range() {
  if [[ -n "${ALICE_ENTERPRISE_FOCUS_BASE_SHA:-}" && -n "${ALICE_ENTERPRISE_FOCUS_HEAD_SHA:-}" ]]; then
    local explicit_mode="${ALICE_ENTERPRISE_FOCUS_DIFF_MODE:-double_dot}"
    printf '%s\n%s\n%s\n%s\n' \
      "${ALICE_ENTERPRISE_FOCUS_BASE_SHA}" \
      "${ALICE_ENTERPRISE_FOCUS_HEAD_SHA}" \
      "${explicit_mode}" \
      'range_explicit'
    return
  fi

  if [[ -z "${GITHUB_EVENT_NAME:-}" || -z "${GITHUB_EVENT_PATH:-}" || ! -f "${GITHUB_EVENT_PATH}" ]]; then
    return
  fi

  local parsed_range
  parsed_range="$(
    node <<'NODE'
const fs = require('fs');

const eventPath = process.env.GITHUB_EVENT_PATH;
const eventName = process.env.GITHUB_EVENT_NAME ?? '';

if (!eventPath || !fs.existsSync(eventPath)) {
  process.exit(0);
}

const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
let baseSha = '';
let headSha = '';
let diffMode = '';
let source = '';

if (eventName === 'push') {
  baseSha = typeof event.before === 'string' ? event.before : '';
  headSha = typeof event.after === 'string' ? event.after : (process.env.GITHUB_SHA ?? '');
  diffMode = /^0+$/.test(baseSha) ? 'single_commit' : 'double_dot';
  source = 'github_push';
} else if (eventName.startsWith('pull_request')) {
  baseSha = event.pull_request?.base?.sha ?? '';
  headSha = event.pull_request?.head?.sha ?? (process.env.GITHUB_SHA ?? '');
  diffMode = 'triple_dot';
  source = 'github_pull_request';
}

if (!baseSha || !headSha) {
  process.exit(0);
}

process.stdout.write(`${baseSha}\n${headSha}\n${diffMode}\n${source}`);
NODE
  )"

  if [[ -z "${parsed_range}" ]]; then
    return
  fi

  printf '%s\n' "${parsed_range}"
}

count_changed_paths() {
  local base_ref="$1"
  local head_ref="$2"
  local diff_mode="$3"

  case "$diff_mode" in
    triple_dot)
      git diff --name-only "${base_ref}...${head_ref}" | sed '/^$/d'
      ;;
    single_commit)
      git show --pretty=format: --name-only "${head_ref}" | sed '/^$/d'
      ;;
    *)
      git diff --name-only "${base_ref}..${head_ref}" | sed '/^$/d'
      ;;
  esac
}

count_commits_in_range() {
  local base_ref="$1"
  local head_ref="$2"
  local diff_mode="$3"

  case "$diff_mode" in
    single_commit)
      printf '1'
      ;;
    *)
      git rev-list --count "${base_ref}..${head_ref}" | tr -d ' '
      ;;
  esac
}

HISTORICAL_RANGE="$(resolve_historical_range)"
RANGE="$HISTORICAL_RANGE"
ANALYSIS_SOURCE='historical_window'
DOC_CHURN_LABEL='Churn documental'
HISTORICAL_ONLY_NOTE=''

event_range=()
while IFS= read -r line; do
  event_range+=("$line")
done < <(resolve_event_range || true)

if (( ${#event_range[@]} == 4 )) && is_valid_commit_ref "${event_range[1]}"; then
  if [[ "${event_range[2]}" == 'single_commit' ]] || is_valid_commit_ref "${event_range[0]}"; then
    RANGE="${event_range[0]}..${event_range[1]}"
    ANALYSIS_SOURCE="${event_range[3]}"
    DOC_CHURN_LABEL='Churn documental (delta atual)'
    HISTORICAL_ONLY_NOTE='Churn documental histórico (telemetria)'
    touches_total="$(count_changed_paths "${event_range[0]}" "${event_range[1]}" "${event_range[2]}" | wc -l | tr -d ' ')"
    doc_touches="$(count_changed_paths "${event_range[0]}" "${event_range[1]}" "${event_range[2]}" | grep -E '^(docs/|README\.md$)' || true)"
    doc_touches="$(printf '%s\n' "$doc_touches" | sed '/^$/d' | wc -l | tr -d ' ')"
    commits_total="$(count_commits_in_range "${event_range[0]}" "${event_range[1]}" "${event_range[2]}")"
    wise_commit_mentions="$(git log --pretty=format:%s "${event_range[0]}..${event_range[1]}" | grep -Ei 'wise' || true)"
    wise_commit_mentions="$(printf '%s\n' "$wise_commit_mentions" | sed '/^$/d' | wc -l | tr -d ' ')"
  fi
fi

if [[ "${ANALYSIS_SOURCE}" == 'historical_window' ]]; then
  commits_total="$(git log --pretty=format:%s "$RANGE" | sed '/^$/d' | wc -l | tr -d ' ')"
  touches_total="$(git log --name-only --pretty=format: "$RANGE" | sed '/^$/d' | wc -l | tr -d ' ')"
  doc_touches="$(git log --name-only --pretty=format: "$RANGE" | sed '/^$/d' | grep -E '^(docs/|README\.md$)' || true)"
  doc_touches="$(printf '%s\n' "$doc_touches" | sed '/^$/d' | wc -l | tr -d ' ')"
  wise_commit_mentions="$(git log --pretty=format:%s "$RANGE" | grep -Ei 'wise' || true)"
  wise_commit_mentions="$(printf '%s\n' "$wise_commit_mentions" | sed '/^$/d' | wc -l | tr -d ' ')"
fi

historical_touches_total="$(git log --name-only --pretty=format: "$HISTORICAL_RANGE" | sed '/^$/d' | wc -l | tr -d ' ')"
historical_doc_touches="$(git log --name-only --pretty=format: "$HISTORICAL_RANGE" | sed '/^$/d' | grep -E '^(docs/|README\.md$)' || true)"
historical_doc_touches="$(printf '%s\n' "$historical_doc_touches" | sed '/^$/d' | wc -l | tr -d ' ')"

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

historical_doc_touch_pct="0"
if (( historical_touches_total > 0 )); then
  historical_doc_touch_pct="$(awk "BEGIN { printf \"%.2f\", (${historical_doc_touches} * 100) / ${historical_touches_total} }")"
fi

echo "Modo de análise: ${ANALYSIS_SOURCE}"
echo "Range principal: ${RANGE}"
echo "Commits no range principal: ${commits_total}"
echo "Touches totais: ${touches_total}"
echo "Touches docs+README: ${doc_touches} (${doc_touch_pct}%)"
if [[ -n "${HISTORICAL_ONLY_NOTE}" ]]; then
  echo "Range histórico auxiliar: ${HISTORICAL_RANGE}"
  echo "Touches docs+README histórico: ${historical_doc_touches} (${historical_doc_touch_pct}%)"
fi
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

check_pct_lte "$doc_touch_pct" "$DOC_TOUCH_THRESHOLD_PCT" "$DOC_CHURN_LABEL"
check_pct_lte "$wise_commit_pct" "$WISE_COMMIT_THRESHOLD_PCT" "Foco desbalanceado no domínio Wise"
check_lte "$wise_files" "$WISE_FILES_THRESHOLD" "Fragmentação de arquivos Wise"
check_lte "$wise_loc" "$WISE_LOC_THRESHOLD" "Densidade total Wise"
check_lte "$trading_content_lines" "$TRADING_CONTENT_LINES_THRESHOLD" "Densidade TradingContent"
check_lte "$chat_layout_controller_lines" "$CHAT_LAYOUT_CONTROLLER_LINES_THRESHOLD" "Densidade Chat layout controller"

if [[ -n "${HISTORICAL_ONLY_NOTE}" ]]; then
  if awk "BEGIN { exit !(${historical_doc_touch_pct} <= ${DOC_TOUCH_THRESHOLD_PCT}) }"; then
    echo "OK   - ${HISTORICAL_ONLY_NOTE}: ${historical_doc_touch_pct}% <= ${DOC_TOUCH_THRESHOLD_PCT}%"
  else
    echo "WARN - ${HISTORICAL_ONLY_NOTE}: ${historical_doc_touch_pct}% > ${DOC_TOUCH_THRESHOLD_PCT}%"
  fi
fi

if (( failed != 0 )); then
  if [[ "${ENFORCE_FAILURE}" == "true" ]]; then
    echo "Resultado: FAIL (há regressões de governança)."
    exit 1
  fi
  echo "Resultado: WARN (há regressões históricas; monitoramento sem bloqueio nesta execução)."
  exit 0
fi

echo "Resultado: OK (guardrails atendidos)."
