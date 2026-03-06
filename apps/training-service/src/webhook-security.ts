import crypto from 'crypto';

export type WebhookSignatureValidationResult = {
  ok: boolean;
  mode: 'internal_api_secret' | 'legacy_webhook_secret' | 'none';
};

export type WebhookBodyDigestValidationResult = {
  ok: boolean;
  result: 'accepted' | 'rejected' | 'skipped';
};

export function validateWebhookSignature(params: {
  signature: string;
  payload: string;
  webhookSecret: string;
  internalApiSecret?: string;
  allowLegacySignature: boolean;
}): WebhookSignatureValidationResult {
  if (params.internalApiSecret) {
    const expectedInternalSignature = crypto
      .createHmac('sha256', params.internalApiSecret)
      .update(params.payload)
      .digest('hex');
    const internalMatch = params.signature.length === expectedInternalSignature.length
      && crypto.timingSafeEqual(
        Buffer.from(params.signature, 'utf8'),
        Buffer.from(expectedInternalSignature, 'utf8')
      );
    if (internalMatch) {
      return { ok: true, mode: 'internal_api_secret' };
    }
  }

  if (params.allowLegacySignature) {
    const expectedLegacySignature = crypto
      .createHmac('sha256', params.webhookSecret)
      .update(params.payload)
      .digest('hex');
    const legacyMatch = params.signature.length === expectedLegacySignature.length
      && crypto.timingSafeEqual(
        Buffer.from(params.signature, 'utf8'),
        Buffer.from(expectedLegacySignature, 'utf8')
      );
    if (legacyMatch) {
      return { ok: true, mode: 'legacy_webhook_secret' };
    }
  }

  return { ok: false, mode: 'none' };
}

export function validateWebhookBodyDigest(params: {
  payload: unknown;
  expectedDigest?: string | null;
  rawBody?: Buffer | string | null;
}): WebhookBodyDigestValidationResult {
  const expected = params.expectedDigest?.trim().toLowerCase() ?? '';
  if (!expected) {
    return { ok: true, result: 'skipped' };
  }
  if (!/^[a-f0-9]{64}$/i.test(expected)) {
    return { ok: false, result: 'rejected' };
  }

  const rawBodyBuffer = typeof params.rawBody === 'string'
    ? Buffer.from(params.rawBody, 'utf8')
    : (params.rawBody ?? null);
  const bodyBytes = rawBodyBuffer ?? Buffer.from(JSON.stringify(params.payload), 'utf8');
  const computed = crypto
    .createHash('sha256')
    .update(bodyBytes)
    .digest('hex');

  const matches = expected.length === computed.length
    && crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(computed, 'utf8')
    );

  return matches
    ? { ok: true, result: 'accepted' }
    : { ok: false, result: 'rejected' };
}
