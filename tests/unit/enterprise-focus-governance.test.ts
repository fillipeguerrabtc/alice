import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const SCRIPT_PATH = path.join(process.cwd(), 'scripts/verify-enterprise-focus.sh');

function createGovernanceFixture(): {
  cleanup: () => void;
  repoDir: string;
  headSha: string;
} {
  const repoDir = mkdtempSync(path.join(tmpdir(), 'alice-governance-'));

  mkdirSync(path.join(repoDir, 'scripts'), { recursive: true });
  mkdirSync(path.join(repoDir, 'apps/frontend-service/src/pages/wise-payments'), { recursive: true });
  mkdirSync(path.join(repoDir, 'apps/frontend-service/src/pages/Chat'), { recursive: true });
  mkdirSync(path.join(repoDir, 'docs/engineering'), { recursive: true });

  writeFileSync(path.join(repoDir, 'scripts/verify-enterprise-focus.sh'), readFileSync(SCRIPT_PATH, 'utf-8'));
  writeFileSync(path.join(repoDir, 'apps/frontend-service/src/pages/wise-payments/index.tsx'), 'export const wise = true;\n');
  writeFileSync(path.join(repoDir, 'apps/frontend-service/src/pages/TradingContent.tsx'), 'export const trading = true;\n');
  writeFileSync(
    path.join(repoDir, 'apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts'),
    'export const controller = true;\n',
  );
  writeFileSync(path.join(repoDir, 'docs/engineering/pipeline-overview.md'), '# Pipeline\n');
  writeFileSync(path.join(repoDir, 'README.md'), '# Alice\n');
  writeFileSync(path.join(repoDir, 'feature.ts'), 'export const feature = 1;\n');

  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Codex'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'codex@example.com'], { cwd: repoDir });
  execFileSync('git', ['add', '.'], { cwd: repoDir });
  execFileSync('git', ['commit', '--quiet', '-m', 'chore: seed governance fixture'], { cwd: repoDir });

  writeFileSync(path.join(repoDir, 'feature.ts'), 'export const feature = 2;\n');
  execFileSync('git', ['add', 'feature.ts'], { cwd: repoDir });
  execFileSync('git', ['commit', '--quiet', '-m', 'Wise: single commit governance coverage'], { cwd: repoDir });

  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf-8' }).trim();

  return {
    cleanup: () => rmSync(repoDir, { recursive: true, force: true }),
    repoDir,
    headSha,
  };
}

function createPullRequestGovernanceFixture(): {
  cleanup: () => void;
  repoDir: string;
  baseSha: string;
  headSha: string;
} {
  const repoDir = mkdtempSync(path.join(tmpdir(), 'alice-governance-pr-'));

  mkdirSync(path.join(repoDir, 'scripts'), { recursive: true });
  mkdirSync(path.join(repoDir, 'apps/frontend-service/src/pages/wise-payments'), { recursive: true });
  mkdirSync(path.join(repoDir, 'apps/frontend-service/src/pages/Chat'), { recursive: true });
  mkdirSync(path.join(repoDir, 'docs/engineering'), { recursive: true });

  writeFileSync(path.join(repoDir, 'scripts/verify-enterprise-focus.sh'), readFileSync(SCRIPT_PATH, 'utf-8'));
  writeFileSync(path.join(repoDir, 'apps/frontend-service/src/pages/wise-payments/index.tsx'), 'export const wise = true;\n');
  writeFileSync(path.join(repoDir, 'apps/frontend-service/src/pages/TradingContent.tsx'), 'export const trading = true;\n');
  writeFileSync(
    path.join(repoDir, 'apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts'),
    'export const controller = true;\n',
  );
  writeFileSync(path.join(repoDir, 'docs/engineering/pipeline-overview.md'), '# Pipeline\n');
  writeFileSync(path.join(repoDir, 'README.md'), '# Alice\n');
  writeFileSync(path.join(repoDir, 'feature.ts'), 'export const feature = 1;\n');

  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Codex'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'codex@example.com'], { cwd: repoDir });
  execFileSync('git', ['add', '.'], { cwd: repoDir });
  execFileSync('git', ['commit', '--quiet', '-m', 'chore: seed governance fixture'], { cwd: repoDir });

  execFileSync('git', ['checkout', '--quiet', '-b', 'feature/governance-scope'], { cwd: repoDir });
  writeFileSync(path.join(repoDir, 'feature.ts'), 'export const feature = 2;\n');
  execFileSync('git', ['add', 'feature.ts'], { cwd: repoDir });
  execFileSync('git', ['commit', '--quiet', '-m', 'feat: branch-specific governance coverage'], { cwd: repoDir });

  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf-8' }).trim();

  execFileSync('git', ['checkout', '--quiet', 'main'], { cwd: repoDir });
  writeFileSync(path.join(repoDir, 'README.md'), '# Alice Wise Base\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
  execFileSync('git', ['commit', '--quiet', '-m', 'Wise: base branch only commit'], { cwd: repoDir });

  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf-8' }).trim();

  return {
    cleanup: () => rmSync(repoDir, { recursive: true, force: true }),
    repoDir,
    baseSha,
    headSha,
  };
}

describe('enterprise focus governance script', () => {
  it('prioritizes the current event delta when CI provides GitHub context', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf-8');

    expect(source.includes('GITHUB_EVENT_NAME')).toBe(true);
    expect(source.includes('GITHUB_EVENT_PATH')).toBe(true);
    expect(source.includes("DOC_CHURN_LABEL='Churn documental (delta atual)'")).toBe(true);
    expect(source.includes("source = 'github_push'")).toBe(true);
    expect(source.includes("source = 'github_pull_request'")).toBe(true);
  });

  it('supports explicit base and head overrides for deterministic local validation', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf-8');

    expect(source.includes('ALICE_ENTERPRISE_FOCUS_BASE_SHA')).toBe(true);
    expect(source.includes('ALICE_ENTERPRISE_FOCUS_HEAD_SHA')).toBe(true);
    expect(source.includes('ALICE_ENTERPRISE_FOCUS_DIFF_MODE')).toBe(true);
  });

  it('keeps the historical 50-commit window only as non-blocking telemetry', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf-8');

    expect(source.includes("HISTORICAL_ONLY_NOTE='Churn documental histórico (telemetria)'")).toBe(true);
    expect(source.includes('WARN - ${HISTORICAL_ONLY_NOTE}')).toBe(true);
    expect(source.includes('Resultado: WARN (há regressões históricas; monitoramento sem bloqueio nesta execução).')).toBe(true);
  });

  it('counts Wise mentions correctly when the event delta is a single commit', () => {
    const fixture = createGovernanceFixture();

    try {
      const result = spawnSync('bash', ['scripts/verify-enterprise-focus.sh', '50'], {
        cwd: fixture.repoDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          ALICE_ENTERPRISE_FOCUS_BASE_SHA: '0000000000000000000000000000000000000000',
          ALICE_ENTERPRISE_FOCUS_HEAD_SHA: fixture.headSha,
          ALICE_ENTERPRISE_FOCUS_DIFF_MODE: 'single_commit',
          DOC_TOUCH_THRESHOLD_PCT: '100',
          WISE_COMMIT_THRESHOLD_PCT: '0',
          ENFORCE_FAILURE: 'true',
        },
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('Modo de análise: range_explicit');
      expect(result.stdout).toContain('Commits no range principal: 1');
      expect(result.stdout).toContain('Commits com foco Wise: 1 (100.00%)');
      expect(result.stdout).toContain('FAIL - Foco desbalanceado no domínio Wise: 100.00% > 0%');
    } finally {
      fixture.cleanup();
    }
  });

  it('keeps pull request commit matching restricted to head-side commits only', () => {
    const fixture = createPullRequestGovernanceFixture();

    try {
      const result = spawnSync('bash', ['scripts/verify-enterprise-focus.sh', '50'], {
        cwd: fixture.repoDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          ALICE_ENTERPRISE_FOCUS_BASE_SHA: fixture.baseSha,
          ALICE_ENTERPRISE_FOCUS_HEAD_SHA: fixture.headSha,
          ALICE_ENTERPRISE_FOCUS_DIFF_MODE: 'triple_dot',
          DOC_TOUCH_THRESHOLD_PCT: '100',
          WISE_COMMIT_THRESHOLD_PCT: '0',
          ENFORCE_FAILURE: 'true',
        },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Modo de análise: range_explicit');
      expect(result.stdout).toContain('Commits no range principal: 1');
      expect(result.stdout).toContain('Commits com foco Wise: 0 (0.00%)');
      expect(result.stdout).toContain('OK   - Foco desbalanceado no domínio Wise: 0.00% <= 0%');
    } finally {
      fixture.cleanup();
    }
  });
});
