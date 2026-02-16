#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Testes unitários para modo confiança em deploy-functions.sh
# ═══════════════════════════════════════════════════════════════════════
# Autor: Fillipe Guerra
# Data: 16 de Fevereiro de 2026
#
# Valida que a função try_local_retag() funciona corretamente com
# o novo parâmetro trust_retag (modo confiança vs modo verificação).
#
# REF: CLAUDE.md Regra 9 (Validação contínua)
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

# Cores para output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Contadores
TESTS_PASSED=0
TESTS_FAILED=0

# Função de teste
test_case() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  
  if [ "$expected" = "$actual" ]; then
    echo -e "${GREEN}✓${NC} $name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗${NC} $name"
    echo "  Expected: $expected"
    echo "  Actual: $actual"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

echo "═══════════════════════════════════════════════════════════════════════"
echo "Testes de Sintaxe - deploy-functions.sh"
echo "═══════════════════════════════════════════════════════════════════════"

# Teste 1: Validar sintaxe bash
echo ""
echo "Teste 1: Validação de sintaxe bash"
if bash -n infra/scripts/deploy-functions.sh 2>/dev/null; then
  test_case "Sintaxe bash válida" "pass" "pass"
else
  test_case "Sintaxe bash válida" "pass" "FAIL"
fi

# Teste 2: Verificar se script pode ser sourced
echo ""
echo "Teste 2: Script pode ser sourced"
if (
  export VERSION="v1.0.0"
  export IMAGE_PREFIX="ghcr.io/test/alice"
  set +e
  # shellcheck disable=SC1091
  source infra/scripts/deploy-functions.sh 2>/dev/null
  exit $?
); then
  test_case "Script pode ser sourced" "pass" "pass"
else
  test_case "Script pode ser sourced" "pass" "FAIL"
fi

# Teste 3: Verificar se função try_local_retag existe
echo ""
echo "Teste 3: Função try_local_retag() existe"
if (
  export VERSION="v1.0.0"
  export IMAGE_PREFIX="ghcr.io/test/alice"
  # shellcheck disable=SC1091
  source infra/scripts/deploy-functions.sh 2>/dev/null
  type try_local_retag >/dev/null 2>&1
); then
  test_case "Função try_local_retag() definida" "pass" "pass"
else
  test_case "Função try_local_retag() definida" "pass" "FAIL"
fi

# Teste 4: Verificar se função pull_if_needed existe
echo ""
echo "Teste 4: Função pull_if_needed() existe"
if (
  export VERSION="v1.0.0"
  export IMAGE_PREFIX="ghcr.io/test/alice"
  # shellcheck disable=SC1091
  source infra/scripts/deploy-functions.sh 2>/dev/null
  type pull_if_needed >/dev/null 2>&1
); then
  test_case "Função pull_if_needed() definida" "pass" "pass"
else
  test_case "Função pull_if_needed() definida" "pass" "FAIL"
fi

# Teste 5: Verificar assinatura da função try_local_retag (aceita 2 parâmetros)
echo ""
echo "Teste 5: try_local_retag() aceita parâmetro trust_retag"
# Verificar se função tem referência ao parâmetro $2 e trust_retag
if grep -q 'trust_retag="${2:-false}"' infra/scripts/deploy-functions.sh; then
  test_case "Parâmetro trust_retag implementado" "pass" "pass"
else
  test_case "Parâmetro trust_retag implementado" "pass" "FAIL"
fi

# Teste 6: Verificar modo confiança no código
echo ""
echo "Teste 6: Modo confiança implementado"
if grep -q 'if \[ "$trust_retag" = "true" \]; then' infra/scripts/deploy-functions.sh; then
  test_case "Modo confiança implementado" "pass" "pass"
else
  test_case "Modo confiança implementado" "pass" "FAIL"
fi

# Teste 7: Verificar que pull_if_needed passa trust_retag="true"
echo ""
echo "Teste 7: pull_if_needed() passa trust_retag='true'"
if grep -q 'try_local_retag "$image" "true"' infra/scripts/deploy-functions.sh; then
  test_case "pull_if_needed() usa modo confiança" "pass" "pass"
else
  test_case "pull_if_needed() usa modo confiança" "pass" "FAIL"
fi

# Teste 8: Verificar logs do modo confiança
echo ""
echo "Teste 8: Logs do modo confiança presentes"
if grep -q 'confiança 100% em Release' infra/scripts/deploy-functions.sh && \
   grep -q 'CONFIANÇA TOTAL' infra/scripts/deploy-functions.sh; then
  test_case "Logs de modo confiança presentes" "pass" "pass"
else
  test_case "Logs de modo confiança presentes" "pass" "FAIL"
fi

# Teste 9: Verificar que modo verificação ainda existe (backwards compatibility)
echo ""
echo "Teste 9: Modo verificação mantido (backwards compatibility)"
if grep -q 'docker manifest inspect "$image"' infra/scripts/deploy-functions.sh; then
  test_case "Modo verificação mantido" "pass" "pass"
else
  test_case "Modo verificação mantido" "pass" "FAIL"
fi

# Teste 10: Verificar comentário sobre primeira vez
echo ""
echo "Teste 10: Log 'primeira vez' presente"
if grep -q 'primeira vez que baixa esta imagem' infra/scripts/deploy-functions.sh; then
  test_case "Log 'primeira vez' presente" "pass" "pass"
else
  test_case "Log 'primeira vez' presente" "pass" "FAIL"
fi

# Resultado final
echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "Resultado dos Testes"
echo "═══════════════════════════════════════════════════════════════════════"
echo -e "Passaram: ${GREEN}${TESTS_PASSED}${NC}"
echo -e "Falharam: ${RED}${TESTS_FAILED}${NC}"
echo ""

if [ "$TESTS_FAILED" -eq 0 ]; then
  echo -e "${GREEN}✓ TODOS OS TESTES PASSARAM${NC}"
  exit 0
else
  echo -e "${RED}✗ ALGUNS TESTES FALHARAM${NC}"
  exit 1
fi
