import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { validateWebhookBodyDigest, validateWebhookSignature } from '../../apps/training-service/src/webhook-security';

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('training webhook security', () => {
  const payload = 'user-1:tenant-1:viewer:11111111-1111-1111-1111-111111111111:1710000000';

  it('accepts signature using INTERNAL_API_SECRET', () => {
    const result = validateWebhookSignature({
      signature: sign(payload, 'internal-secret'),
      payload,
      webhookSecret: 'legacy-secret',
      internalApiSecret: 'internal-secret',
      allowLegacySignature: false,
    });

    expect(result).toEqual({ ok: true, mode: 'internal_api_secret' });
  });

  it('rejects invalid signature when legacy mode is disabled', () => {
    const result = validateWebhookSignature({
      signature: sign(payload, 'wrong-secret'),
      payload,
      webhookSecret: 'legacy-secret',
      internalApiSecret: 'internal-secret',
      allowLegacySignature: false,
    });

    expect(result).toEqual({ ok: false, mode: 'none' });
  });

  it('accepts legacy signature only when flag is enabled', () => {
    const signature = sign(payload, 'legacy-secret');

    const accepted = validateWebhookSignature({
      signature,
      payload,
      webhookSecret: 'legacy-secret',
      internalApiSecret: 'internal-secret',
      allowLegacySignature: true,
    });
    expect(accepted).toEqual({ ok: true, mode: 'legacy_webhook_secret' });

    const rejected = validateWebhookSignature({
      signature,
      payload,
      webhookSecret: 'legacy-secret',
      internalApiSecret: 'internal-secret',
      allowLegacySignature: false,
    });
    expect(rejected).toEqual({ ok: false, mode: 'none' });
  });

  it('prefers INTERNAL_API_SECRET when both modes are possible', () => {
    const result = validateWebhookSignature({
      signature: sign(payload, 'same-secret'),
      payload,
      webhookSecret: 'same-secret',
      internalApiSecret: 'same-secret',
      allowLegacySignature: true,
    });

    expect(result).toEqual({ ok: true, mode: 'internal_api_secret' });
  });

  it('handles malformed signature length safely', () => {
    const result = validateWebhookSignature({
      signature: 'abc',
      payload,
      webhookSecret: 'legacy-secret',
      internalApiSecret: 'internal-secret',
      allowLegacySignature: true,
    });

    expect(result).toEqual({ ok: false, mode: 'none' });
  });

  it('validates request body digest when header is provided', () => {
    const payloadObject = {
      event: 'training_data',
      payload: {
        conversationId: 'conv-1',
        messages: [{ role: 'user', content: 'hello' }],
      },
    };
    const digest = crypto
      .createHash('sha256')
      .update(JSON.stringify(payloadObject))
      .digest('hex');

    const accepted = validateWebhookBodyDigest({
      payload: payloadObject,
      expectedDigest: digest,
    });
    expect(accepted).toEqual({ ok: true, result: 'accepted' });

    const rejected = validateWebhookBodyDigest({
      payload: payloadObject,
      expectedDigest: 'deadbeef',
    });
    expect(rejected).toEqual({ ok: false, result: 'rejected' });
  });

  it('skips body digest validation when header is not provided', () => {
    const skipped = validateWebhookBodyDigest({
      payload: { ping: true },
      expectedDigest: undefined,
    });

    expect(skipped).toEqual({ ok: true, result: 'skipped' });
  });
});
