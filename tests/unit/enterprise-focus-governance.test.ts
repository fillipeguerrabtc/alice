import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadEnterpriseFocusScript(): string {
  return readFileSync(path.join(process.cwd(), 'scripts/verify-enterprise-focus.sh'), 'utf-8');
}

describe('enterprise focus governance script', () => {
  it('prioritizes the current event delta when CI provides GitHub context', () => {
    const source = loadEnterpriseFocusScript();

    expect(source.includes('GITHUB_EVENT_NAME')).toBe(true);
    expect(source.includes('GITHUB_EVENT_PATH')).toBe(true);
    expect(source.includes("DOC_CHURN_LABEL='Churn documental (delta atual)'")).toBe(true);
    expect(source.includes("source = 'github_push'")).toBe(true);
    expect(source.includes("source = 'github_pull_request'")).toBe(true);
  });

  it('supports explicit base and head overrides for deterministic local validation', () => {
    const source = loadEnterpriseFocusScript();

    expect(source.includes('ALICE_ENTERPRISE_FOCUS_BASE_SHA')).toBe(true);
    expect(source.includes('ALICE_ENTERPRISE_FOCUS_HEAD_SHA')).toBe(true);
    expect(source.includes('ALICE_ENTERPRISE_FOCUS_DIFF_MODE')).toBe(true);
  });

  it('keeps the historical 50-commit window only as non-blocking telemetry', () => {
    const source = loadEnterpriseFocusScript();

    expect(source.includes("HISTORICAL_ONLY_NOTE='Churn documental histórico (telemetria)'")).toBe(true);
    expect(source.includes('WARN - ${HISTORICAL_ONLY_NOTE}')).toBe(true);
    expect(source.includes('Resultado: WARN (há regressões históricas; monitoramento sem bloqueio nesta execução).')).toBe(true);
  });
});
