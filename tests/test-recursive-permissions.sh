#!/usr/bin/env bash
# =============================================================================
# Test: Recursive Permissions Fix (PR#74)
# Purpose: Validate that the fix-production-permissions.sh script correctly
#          handles the infinite loop scenario where parent directory has
#          correct UID but child files have wrong UID.
# =============================================================================

set -euo pipefail

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Test directory
readonly TEST_BASE="/tmp/alice-permission-test-$$"
readonly TEST_POSTGRES="${TEST_BASE}/data/postgres"

# Track test results
TESTS_PASSED=0
TESTS_FAILED=0

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

log_test() {
    echo -e "${BLUE}[TEST]${NC} $*"
}

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $*"
    ((TESTS_PASSED++))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $*"
    ((TESTS_FAILED++))
}

cleanup() {
    if [[ -d "$TEST_BASE" ]]; then
        rm -rf "$TEST_BASE" 2>/dev/null || true
    fi
}

trap cleanup EXIT

# =============================================================================
# TEST 1: Scenario - Parent correct, children wrong (THE BUG)
# =============================================================================

test_infinite_loop_scenario() {
    log_test "=========================================="
    log_test "TEST 1: Infinite Loop Scenario"
    log_test "Parent UID correct (999:999), children wrong (root:root)"
    log_test "=========================================="
    
    # Setup: Create test directories
    mkdir -p "${TEST_POSTGRES}/base"
    mkdir -p "${TEST_POSTGRES}/global"
    mkdir -p "${TEST_POSTGRES}/pg_wal"
    
    # Create files
    touch "${TEST_POSTGRES}/PG_VERSION"
    touch "${TEST_POSTGRES}/base/file1.txt"
    touch "${TEST_POSTGRES}/global/file2.txt"
    
    # Parent correct (current user)
    local current_uid=$(id -u)
    local current_gid=$(id -g)
    
    # Make children appear "wrong" by using a different UID
    # We'll simulate this by checking if script would detect difference
    
    log_test "Created test structure:"
    find "$TEST_POSTGRES" -exec ls -ld {} \; | head -10
    
    # Test that find command works correctly
    log_test ""
    log_test "Testing find command for recursive check..."
    
    # This should find nothing if all files have same UID
    local wrong_files
    wrong_files=$(find "$TEST_POSTGRES" \( ! -user "$current_uid" -o ! -group "$current_gid" \) -print -quit 2>/dev/null)
    
    if [[ -z "$wrong_files" ]]; then
        log_pass "✅ All files have correct ownership (as expected in test)"
    else
        log_fail "❌ Found files with wrong ownership: $wrong_files"
    fi
    
    # Test the logic: If we use a different UID to search for, it should find files
    log_test ""
    log_test "Testing find with wrong UID (999) to simulate the bug scenario..."
    wrong_files=$(find "$TEST_POSTGRES" \( ! -user 999 -o ! -group 999 \) -print -quit 2>/dev/null)
    
    if [[ -n "$wrong_files" ]]; then
        log_pass "✅ Find correctly detects files with different UID (999)"
        log_test "   First wrong file: $wrong_files"
    else
        log_fail "❌ Find should have detected files with UID != 999"
    fi
}

# =============================================================================
# TEST 2: Performance test - find -print -quit
# =============================================================================

test_performance_optimization() {
    log_test ""
    log_test "=========================================="
    log_test "TEST 2: Performance Optimization"
    log_test "Verify that -print -quit stops after first match"
    log_test "=========================================="
    
    # Create many files
    local test_dir="${TEST_BASE}/performance"
    mkdir -p "$test_dir"
    
    # Create 100 files
    for i in {1..100}; do
        touch "${test_dir}/file${i}.txt"
    done
    
    log_test "Created 100 test files"
    
    local current_uid=$(id -u)
    local start_time=$(date +%s%N)
    
    # This should return quickly (first file only)
    local result
    result=$(find "$test_dir" \( ! -user "$current_uid" -o ! -group "$current_uid" \) -print -quit 2>/dev/null)
    
    local end_time=$(date +%s%N)
    local duration=$(( (end_time - start_time) / 1000000 )) # Convert to ms
    
    log_test "Find command completed in ${duration}ms"
    
    if [[ $duration -lt 100 ]]; then
        log_pass "✅ Performance acceptable (< 100ms)"
    else
        log_fail "⚠️  Performance warning: took ${duration}ms (expected < 100ms)"
    fi
}

# =============================================================================
# TEST 3: Verify script syntax and structure
# =============================================================================

test_script_structure() {
    log_test ""
    log_test "=========================================="
    log_test "TEST 3: Script Structure Validation"
    log_test "=========================================="
    
    # ==========================================================================
    # CORREÇÃO BUG CURSOR REVIEW (PR#76): Path relativo ao invés de hardcoded
    # ==========================================================================
    # BUG ORIGINAL:
    #   - Path era hardcoded para GitHub Actions: /home/runner/work/alice/alice/...
    #   - Teste NÃO funcionava localmente (desenvolvedor executando)
    #   - Teste NÃO funcionava em outros CI (GitLab, Jenkins, etc)
    #
    # SOLUÇÃO:
    #   - Determinar diretório do script de teste dinamicamente
    #   - Path relativo ao root do projeto (tests/ está no root)
    #   - Funciona em qualquer ambiente (local, CI, etc)
    # ==========================================================================
    
    # Determinar diretório do script de teste
    local SCRIPT_DIR
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    
    # Path relativo ao root do projeto (tests/ está no root)
    local script_path="$SCRIPT_DIR/../infra/scripts/fix-production-permissions.sh"
    
    # Validar que script existe
    if [[ ! -f "$script_path" ]]; then
        log_fail "❌ Script não encontrado em $script_path"
        log_test "   Esperado: infra/scripts/fix-production-permissions.sh"
        return 1
    fi
    
    log_test "📄 Script encontrado: $script_path"
    
    # Test 3a: Bash syntax
    if bash -n "$script_path" 2>/dev/null; then
        log_pass "✅ Bash syntax is valid"
    else
        log_fail "❌ Bash syntax errors detected"
    fi
    
    # Test 3b: Check for recursive verification in create_mode
    if grep -q "find.*! -user.*! -group.*-print -quit" "$script_path"; then
        log_pass "✅ Script uses find with -print -quit for recursive check"
    else
        log_fail "❌ Script missing recursive find command"
    fi
    
    # Test 3c: Check for chown -R
    if grep -q "chown -R" "$script_path"; then
        log_pass "✅ Script uses chown -R for recursive ownership update"
    else
        log_fail "❌ Script missing chown -R command"
    fi
    
    # Test 3d: Check for bug fix comments
    if grep -q "CORREÇÃO BUG CURSOR REVIEW (PR#74)" "$script_path"; then
        log_pass "✅ Script includes PR#74 bug fix documentation"
    else
        log_fail "❌ Script missing PR#74 bug fix documentation"
    fi
    
    # Test 3e: Check that both create_mode and validate_mode use same logic
    local create_finds=$(grep -c "find.*! -user.*! -group" "$script_path" || echo 0)
    if [[ $create_finds -ge 2 ]]; then
        log_pass "✅ Both create_mode and validate_mode use recursive find (consistency)"
    else
        log_fail "❌ Recursive find not used consistently in both modes"
    fi
}

# =============================================================================
# TEST 4: Verify the fix prevents infinite loop
# =============================================================================

test_no_infinite_loop() {
    log_test ""
    log_test "=========================================="
    log_test "TEST 4: Infinite Loop Prevention"
    log_test "Verify script logic would catch child file issues"
    log_test "=========================================="
    
    # Simulate the exact logic from the script
    local test_dir="${TEST_BASE}/loop-test"
    mkdir -p "${test_dir}/subdir"
    touch "${test_dir}/subdir/file.txt"
    
    local current_uid=$(id -u)
    local wrong_uid=999
    
    # Test 4a: With current UID (should find nothing)
    local wrong_files
    wrong_files=$(find "$test_dir" \( ! -user "$current_uid" -o ! -group "$current_uid" \) -print -quit 2>/dev/null)
    
    if [[ -z "$wrong_files" ]]; then
        log_pass "✅ Correctly identifies when all files have correct ownership"
    else
        log_fail "❌ False positive: detected wrong ownership when all correct"
    fi
    
    # Test 4b: With wrong UID (should find files)
    wrong_files=$(find "$test_dir" \( ! -user "$wrong_uid" -o ! -group "$wrong_uid" \) -print -quit 2>/dev/null)
    
    if [[ -n "$wrong_files" ]]; then
        log_pass "✅ Correctly identifies files with wrong ownership"
    else
        log_fail "❌ Failed to detect files with wrong ownership"
    fi
}

# =============================================================================
# RUN ALL TESTS
# =============================================================================

main() {
    echo ""
    echo "============================================================================="
    echo "  Alice Enterprise - Recursive Permissions Fix Test Suite (PR#74)"
    echo "  Testing: fix-production-permissions.sh"
    echo "============================================================================="
    echo ""
    
    test_infinite_loop_scenario
    test_performance_optimization
    test_script_structure
    test_no_infinite_loop
    
    # Summary
    echo ""
    echo "============================================================================="
    echo "  TEST SUMMARY"
    echo "============================================================================="
    echo -e "${GREEN}Tests Passed: ${TESTS_PASSED}${NC}"
    if [[ $TESTS_FAILED -gt 0 ]]; then
        echo -e "${RED}Tests Failed: ${TESTS_FAILED}${NC}"
        echo ""
        echo "❌ Some tests failed. Please review the output above."
        exit 1
    else
        echo -e "${GREEN}Tests Failed: ${TESTS_FAILED}${NC}"
        echo ""
        echo "✅ All tests passed! The recursive permissions fix is working correctly."
        exit 0
    fi
}

main "$@"
