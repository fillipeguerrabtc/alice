import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('backup restore game day guards', () => {
  it('keeps DR runbook with explicit RTO/RPO targets', () => {
    const runbook = read('docs/operations/runbooks/dr-game-day.md');
    expect(runbook.includes('`RTO` alvo')).toBe(true);
    expect(runbook.includes('`RPO` alvo')).toBe(true);
    expect(runbook.includes('Game Day')).toBe(true);
  });

  it('keeps restore endpoint and dry-run path in backup orchestrator', () => {
    const source = read('apps/observability-service/src/backup-orchestrator.ts');
    expect(source.includes("router.post('/restore'")).toBe(true);
    expect(source.includes('dryRun')).toBe(true);
    expect(source.includes('confirm: z.literal(true')).toBe(true);
  });
});
