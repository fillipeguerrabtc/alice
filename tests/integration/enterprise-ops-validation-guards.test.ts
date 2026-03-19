import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('enterprise ops validation guards', () => {
  it('keeps DR, GPU fine-tuning and SLO validation scripts available', () => {
    expect(existsSync(path.join(process.cwd(), 'infra/scripts/run-dr-game-day.sh'))).toBe(true);
    expect(existsSync(path.join(process.cwd(), 'infra/scripts/validate-gpu-fine-tuning.sh'))).toBe(true);
    expect(existsSync(path.join(process.cwd(), 'infra/scripts/validate-slo-burn-rates.sh'))).toBe(true);
  });

  it('keeps runbooks for DR, training GPU validation and SLO burn-rate', () => {
    const drRunbook = read('docs/operations/runbooks/dr-game-day.md');
    const gpuRunbook = read('docs/operations/runbooks/training-gpu-validation.md');
    const sloRunbook = read('docs/operations/runbooks/slo-burn-rate-validation.md');

    expect(drRunbook.includes('run-dr-game-day.sh')).toBe(true);
    expect(gpuRunbook.includes('validate-gpu-fine-tuning.sh')).toBe(true);
    expect(sloRunbook.includes('validate-slo-burn-rates.sh')).toBe(true);
  });
});
