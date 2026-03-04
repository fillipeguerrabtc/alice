import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readTrainingPageSource(): string {
  const trainingPagePath = path.join(
    process.cwd(),
    'apps',
    'frontend-service',
    'src',
    'pages',
    'Training.tsx'
  );
  return readFileSync(trainingPagePath, 'utf-8');
}

describe('Training frontend idempotency headers', () => {
  it('defines idempotency key helper for training starts', () => {
    const source = readTrainingPageSource();
    expect(source).toMatch(/function generateTrainingIdempotencyKey\(/);
  });

  it('sends X-Idempotency-Key on custom job start request', () => {
    const source = readTrainingPageSource();
    expect(source).toMatch(
      /apiRequest\(\s*'POST'\s*,\s*'\/api\/training\/jobs'[\s\S]*?headers:\s*\{[\s\S]*?'X-Idempotency-Key'/
    );
  });

  it('sends X-Idempotency-Key on on-demand run start request', () => {
    const source = readTrainingPageSource();
    expect(source).toMatch(
      /apiRequest\(\s*'POST'\s*,\s*'\/api\/training\/run\/start'[\s\S]*?headers:\s*\{[\s\S]*?'X-Idempotency-Key'/
    );
  });
});
