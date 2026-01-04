#!/bin/bash
# =============================================================================
# Test Script - Automatic Version Calculation Logic
# =============================================================================
# Descrição: Valida a lógica de cálculo automático de versão implementada
#            no workflow release.yml
#
# Author: Fillipe Guerra
# Data: 04/01/2026
# =============================================================================

set -e

echo "=== Teste de Cálculo Automático de Versão ==="
echo ""

# Função auxiliar para testar cálculo de versão
test_version_calculation() {
  local test_name="$1"
  local previous_tag="$2"
  local commits="$3"
  local expected_version="$4"
  
  echo "📋 Teste: $test_name"
  echo "   Tag anterior: ${previous_tag:-<nenhuma>}"
  
  # Lógica idêntica ao workflow
  if [ -z "$previous_tag" ]; then
    # Primeiro release
    NEXT_VERSION="v1.0.0"
    echo "   ℹ️ Nenhuma tag anterior - usando v1.0.0"
  else
    # Remover prefixo v para cálculo
    CURRENT=$(echo "$previous_tag" | sed 's/^v//')
    MAJOR=$(echo "$CURRENT" | cut -d. -f1)
    MINOR=$(echo "$CURRENT" | cut -d. -f2)
    PATCH=$(echo "$CURRENT" | cut -d- -f1 | cut -d. -f3)
    
    # Detectar tipo de mudança (mesma lógica do changelog)
    if echo "$commits" | grep -qE "^[a-z]+(\(.+\))?!:|BREAKING CHANGE:"; then
      # MAJOR: Breaking change
      MAJOR=$((MAJOR + 1))
      MINOR=0
      PATCH=0
      CHANGE_TYPE="MAJOR (breaking change detectado)"
    elif echo "$commits" | grep -qE "^feat(\(.+\))?:"; then
      # MINOR: Nova feature
      MINOR=$((MINOR + 1))
      PATCH=0
      CHANGE_TYPE="MINOR (feat detectado)"
    else
      # PATCH: Bug fix ou outros
      PATCH=$((PATCH + 1))
      CHANGE_TYPE="PATCH (fix ou outros)"
    fi
    
    NEXT_VERSION="v${MAJOR}.${MINOR}.${PATCH}"
    echo "   ✅ Tipo de mudança: $CHANGE_TYPE"
  fi
  
  echo "   ✅ Versão calculada: $NEXT_VERSION"
  
  if [ "$NEXT_VERSION" = "$expected_version" ]; then
    echo "   ✅ PASSOU - Versão esperada: $expected_version"
    return 0
  else
    echo "   ❌ FALHOU - Esperado: $expected_version, Obtido: $NEXT_VERSION"
    return 1
  fi
}

# Contadores de testes
TESTS_PASSED=0
TESTS_FAILED=0

# Teste 1: Primeiro release (sem tag anterior)
echo ""
if test_version_calculation \
  "Primeiro release" \
  "" \
  "feat: primeira feature" \
  "v1.0.0"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Teste 2: PATCH bump (fix)
echo ""
if test_version_calculation \
  "PATCH bump - fix commit" \
  "v2.7.0" \
  "fix: corrige bug crítico" \
  "v2.7.1"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Teste 3: MINOR bump (feat)
echo ""
if test_version_calculation \
  "MINOR bump - feat commit" \
  "v2.7.0" \
  "feat: adiciona nova funcionalidade" \
  "v2.8.0"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Teste 4: MAJOR bump (breaking change com !)
echo ""
if test_version_calculation \
  "MAJOR bump - breaking change com !" \
  "v2.7.0" \
  "feat!: remove API antiga" \
  "v3.0.0"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Teste 5: MAJOR bump (BREAKING CHANGE:)
echo ""
if test_version_calculation \
  "MAJOR bump - BREAKING CHANGE:" \
  "v2.7.0" \
  "refactor: reescreve módulo
BREAKING CHANGE: API completamente alterada" \
  "v3.0.0"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Teste 6: PATCH bump (commit sem tipo)
echo ""
if test_version_calculation \
  "PATCH bump - commit sem tipo" \
  "v2.7.0" \
  "atualiza documentação" \
  "v2.7.1"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Teste 7: MINOR bump (múltiplos commits, feat tem prioridade)
echo ""
if test_version_calculation \
  "MINOR bump - múltiplos commits com feat" \
  "v2.7.0" \
  "fix: corrige bug
feat: adiciona feature
docs: atualiza README" \
  "v2.8.0"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Teste 8: MAJOR bump tem prioridade sobre feat/fix
echo ""
if test_version_calculation \
  "MAJOR bump - tem prioridade sobre feat/fix" \
  "v2.7.0" \
  "feat: adiciona feature
fix: corrige bug
feat!: remove API antiga" \
  "v3.0.0"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Resultado final
echo ""
echo "=== Resultado dos Testes ==="
echo "✅ Testes passaram: $TESTS_PASSED"
echo "❌ Testes falharam: $TESTS_FAILED"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo "🎉 Todos os testes passaram!"
  exit 0
else
  echo "❌ Alguns testes falharam!"
  exit 1
fi
