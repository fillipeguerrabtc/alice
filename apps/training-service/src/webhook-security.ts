import crypto from 'crypto';

export type WebhookSignatureValidationResult = {
  ok: boolean;
  mode: 'internal_api_secret' | 'legacy_webhook_secret' | 'none';
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
