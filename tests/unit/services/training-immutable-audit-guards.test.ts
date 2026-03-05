import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadTrainingSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'training-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('training immutable audit guards', () => {
  it('keeps immutable audit helper wired with transaction-capable executor path', () => {
    const source = loadTrainingSource();
    expect(source.includes('appendImmutableAuditEventWithExecutor')).toBe(true);
    expect(source.includes('type TrainingAuditExecutor = Pick<Database, \'execute\' | \'select\' | \'insert\'>;')).toBe(true);
    expect(source.includes('if (params.executor) {')).toBe(true);
    expect(source.includes('await params.executor.insert(schema.auditLogs).values(auditValues);')).toBe(true);
  });

  it('writes training governance events to immutable stream with deterministic stream key', () => {
    const source = loadTrainingSource();
    expect(source.includes("stream: 'training_governance',")).toBe(true);
    expect(source.includes('streamKey: `${auditValues.recurso}:${auditValues.recursoId}`,')).toBe(true);
    expect(source.includes("sourceService: 'training-service',")).toBe(true);
    expect(source.includes('extractRequestCorrelationId(params.request)')).toBe(true);
  });
});

