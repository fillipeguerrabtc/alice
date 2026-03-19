import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const SHELL_SCRIPT_PATH = path.join(process.cwd(), 'scripts/verify-enterprise-focus.sh');
const NODE_SCRIPT_PATH = path.join(process.cwd(), 'scripts/verify-enterprise-focus.mjs');
const WORKSPACE_SCOPE_PATH = path.join(process.cwd(), 'scripts/workspace-scope.mjs');

function createGovernanceFixture(): {
  cleanup: () => void;
  repoDir: string;
  baseSha: string;
  headSha: string;
} {
  const repoDir = mkdtempSync(path.join(tmpdir(), 'alice-governance-'));

  mkdirSync(path.join(repoDir, 'scripts'), { recursive: true });
  mkdirSync(path.join(repoDir, '.github', 'workflows'), { recursive: true });
  mkdirSync(path.join(repoDir, 'docs', 'engineering'), { recursive: true });
  mkdirSync(path.join(repoDir, 'apps', 'frontend-service', 'src', 'pages', 'Chat'), {
    recursive: true,
  });

  writeFileSync(
    path.join(repoDir, 'scripts', 'verify-enterprise-focus.sh'),
    readFileSync(SHELL_SCRIPT_PATH, 'utf-8'),
  );
  writeFileSync(
    path.join(repoDir, 'scripts', 'verify-enterprise-focus.mjs'),
    readFileSync(NODE_SCRIPT_PATH, 'utf-8'),
  );
  writeFileSync(
    path.join(repoDir, 'scripts', 'workspace-scope.mjs'),
    readFileSync(WORKSPACE_SCOPE_PATH, 'utf-8'),
  );
  writeFileSync(path.join(repoDir, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
  writeFileSync(path.join(repoDir, 'docs', 'engineering', 'pipeline-overview.md'), '# Pipeline\n');
  writeFileSync(path.join(repoDir, 'README.md'), '# Alice\n');
  writeFileSync(
    path.join(repoDir, 'apps', 'frontend-service', 'src', 'pages', 'Chat', 'Feature.tsx'),
    'export const feature = 1;\n',
  );

  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Codex'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'codex@example.com'], { cwd: repoDir });
  execFileSync('git', ['add', '.'], { cwd: repoDir });
  execFileSync('git', ['commit', '--quiet', '-m', 'chore: seed governance fixture'], { cwd: repoDir });

  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf-8' }).trim();

  return {
    cleanup: () => rmSync(repoDir, { recursive: true, force: true }),
    repoDir,
    baseSha,
    headSha: baseSha,
  };
}

describe('enterprise focus governance script', () => {
  it('prioritizes the current event delta when CI provides GitHub context', () => {
    const source = readFileSync(NODE_SCRIPT_PATH, 'utf-8');

    expect(source.includes('GITHUB_EVENT_NAME')).toBe(true);
    expect(source.includes('GITHUB_EVENT_PATH')).toBe(true);
    expect(source.includes("source: 'github_push'")).toBe(true);
    expect(source.includes("source: 'github_pull_request'")).toBe(true);
  });

  it('supports explicit base and head overrides for deterministic local validation', () => {
    const source = readFileSync(NODE_SCRIPT_PATH, 'utf-8');

    expect(source.includes('ALICE_ENTERPRISE_FOCUS_BASE_SHA')).toBe(true);
    expect(source.includes('ALICE_ENTERPRISE_FOCUS_HEAD_SHA')).toBe(true);
    expect(source.includes('ALICE_ENTERPRISE_FOCUS_DIFF_MODE')).toBe(true);
  });

  it('keeps the historical window only as telemetry', () => {
    const source = readFileSync(NODE_SCRIPT_PATH, 'utf-8');

    expect(source.includes('Range historico auxiliar')).toBe(true);
    expect(source.includes('Churn documental historico (telemetria)')).toBe(true);
    expect(source.includes('Resultado: WARN (telemetria de foco registrou hotspots ou churn acima do alvo).')).toBe(true);
  });

  it('warns without failing when the event delta is documentation-heavy', () => {
    const fixture = createGovernanceFixture();

    try {
      writeFileSync(path.join(fixture.repoDir, 'README.md'), '# Alice docs-heavy\n');
      writeFileSync(
        path.join(fixture.repoDir, 'docs', 'engineering', 'pipeline-overview.md'),
        '# Pipeline updated\n',
      );
      execFileSync('git', ['add', 'README.md', 'docs/engineering/pipeline-overview.md'], {
        cwd: fixture.repoDir,
      });
      execFileSync('git', ['commit', '--quiet', '-m', 'docs: expand pipeline docs'], {
        cwd: fixture.repoDir,
      });

      const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: fixture.repoDir,
        encoding: 'utf-8',
      }).trim();

      const result = spawnSync('bash', ['scripts/verify-enterprise-focus.sh', '50'], {
        cwd: fixture.repoDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          ALICE_ENTERPRISE_FOCUS_BASE_SHA: fixture.baseSha,
          ALICE_ENTERPRISE_FOCUS_HEAD_SHA: headSha,
          ALICE_ENTERPRISE_FOCUS_DIFF_MODE: 'double_dot',
          DOC_TOUCH_WARN_THRESHOLD_PCT: '10',
          PIPELINE_TOUCH_WARN_THRESHOLD_PCT: '100',
        },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Modo de analise: range_explicit');
      expect(result.stdout).toContain('WARN - Churn documental elevado no delta atual');
      expect(result.stdout).toContain('Resultado: WARN (telemetria de foco registrou hotspots ou churn acima do alvo).');
    } finally {
      fixture.cleanup();
    }
  });

  it('fails in strict mode when a changed source file exceeds the strict hotspot limit', () => {
    const fixture = createGovernanceFixture();

    try {
      const oversizedFile = Array.from({ length: 950 }, (_, index) => `export const line${index} = ${index};`)
        .join('\n')
        .concat('\n');
      writeFileSync(
        path.join(fixture.repoDir, 'apps', 'frontend-service', 'src', 'pages', 'Chat', 'Feature.tsx'),
        oversizedFile,
      );
      execFileSync(
        'git',
        ['add', 'apps/frontend-service/src/pages/Chat/Feature.tsx'],
        { cwd: fixture.repoDir },
      );
      execFileSync('git', ['commit', '--quiet', '-m', 'refactor: expand chat feature'], {
        cwd: fixture.repoDir,
      });

      const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: fixture.repoDir,
        encoding: 'utf-8',
      }).trim();

      const result = spawnSync('bash', ['scripts/verify-enterprise-focus.sh', '50'], {
        cwd: fixture.repoDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          ALICE_ENTERPRISE_FOCUS_BASE_SHA: fixture.baseSha,
          ALICE_ENTERPRISE_FOCUS_HEAD_SHA: headSha,
          ALICE_ENTERPRISE_FOCUS_DIFF_MODE: 'double_dot',
          DOC_TOUCH_WARN_THRESHOLD_PCT: '100',
          PIPELINE_TOUCH_WARN_THRESHOLD_PCT: '100',
          LARGE_SOURCE_FILE_WARN_LINES: '100',
          LARGE_SOURCE_FILE_FAIL_LINES: '900',
          ENFORCE_FAILURE: 'true',
        },
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('Top arquivos fonte alterados por densidade');
      expect(result.stdout).toContain('FAIL - Arquivos fonte alterados acima do threshold estrito');
      expect(result.stdout).toContain('Resultado: FAIL (telemetria strict detectou hotspots acima do limite estrito).');
    } finally {
      fixture.cleanup();
    }
  });
});
