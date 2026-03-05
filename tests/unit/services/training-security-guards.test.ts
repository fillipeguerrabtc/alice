import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadTrainingSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'training-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('training-service security guards', () => {
  it('keeps manage RBAC on schedule/run start/cancel endpoints', () => {
    const source = loadTrainingSource();
    expect(
      /app\.post\('\/api\/training\/schedule\/configure',\s*requirePermission\('training:training_data:manage'\),/.test(source)
    ).toBe(true);
    expect(
      /app\.post\('\/api\/training\/run\/start',\s*requirePermission\('training:training_data:manage'\),/.test(source)
    ).toBe(true);
    expect(
      /app\.delete\('\/api\/training\/run\/cancel',\s*requirePermission\('training:training_data:manage'\),/.test(source)
    ).toBe(true);
  });

  it('keeps read RBAC on run status/history and queue status endpoints', () => {
    const source = loadTrainingSource();
    expect(
      /app\.get\('\/api\/training\/run\/status',\s*requirePermission\('training:training_data:read'\),/.test(source)
    ).toBe(true);
    expect(
      /app\.get\('\/api\/training\/run\/history',\s*requirePermission\('training:training_data:read'\),/.test(source)
    ).toBe(true);
    expect(
      /app\.get\('\/api\/training\/queue\/status',\s*requirePermission\('training:fine_tuning_jobs:read'\),/.test(source)
    ).toBe(true);
  });

  it('keeps webhook hardening checks for header schema, signature, body digest and nonce replay', () => {
    const source = loadTrainingSource();
    expect(source.includes("app.post('/api/training/webhook', async (req: Request, res: Response) => {")).toBe(true);
    expect(source.includes('webhookInternalHeadersSchema.safeParse(req.headers)')).toBe(true);
    expect(source.includes('validateWebhookSignature({')).toBe(true);
    expect(source.includes('validateWebhookBodyDigest({')).toBe(true);
    expect(source.includes('validateAndStoreWebhookNonce({')).toBe(true);
    expect(source.includes("return res.status(409).json({ error: 'Nonce ja utilizado (replay detectado)' });")).toBe(true);
  });

  it('keeps run-start idempotency guardrails in place', () => {
    const source = loadTrainingSource();
    expect(source.includes('readOptionalTrainingIdempotencyKey(req)')).toBe(true);
    expect(source.includes('TRAINING_RUN_START_REQUIRE_IDEMPOTENCY_KEY')).toBe(true);
    expect(source.includes("'IDEMPOTENCY_KEY_REQUIRED'")).toBe(true);
    expect(source.includes('lookupRunStartIdempotencyReplay({')).toBe(true);
  });
});
