import { afterEach, describe, expect, it } from 'vitest';
import {
  buildLlmGatewayAuthHeaders,
  buildLlmGatewayRequestHeaders,
} from '../../packages/shared-utils/src/llm/llm-gateway-client';
import { createBackgroundContext, runWithContext } from '../../packages/shared-utils/src/async-context';

const ORIGINAL_INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

afterEach(() => {
  process.env.INTERNAL_API_SECRET = ORIGINAL_INTERNAL_API_SECRET;
});

describe('buildLlmGatewayAuthHeaders', () => {
  it('prioriza headers HMAC quando contexto possui userId', () => {
    process.env.INTERNAL_API_SECRET = 'test-secret';

    const headers = buildLlmGatewayAuthHeaders({
      route: '/trading',
      tenantId: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
    });

    expect(typeof headers['x-internal-signature']).toBe('string');
    expect(typeof headers['x-internal-timestamp']).toBe('string');
    expect(headers['x-internal-user-id']).toBe('22222222-2222-2222-2222-222222222222');
    expect(headers['X-Internal-Api-Secret']).toBeUndefined();
  });

  it('usa fallback legado por secret quando não há userId para assinar HMAC', () => {
    process.env.INTERNAL_API_SECRET = 'legacy-secret';

    const headers = buildLlmGatewayAuthHeaders({
      route: '/training/policy-gate/judge',
      tenantId: '11111111-1111-1111-1111-111111111111',
    });

    expect(headers['X-Internal-Api-Secret']).toBe('legacy-secret');
    expect(headers['x-internal-signature']).toBeUndefined();
  });
});

describe('buildLlmGatewayRequestHeaders', () => {
  it('propaga correlation id e traceparent do contexto async atual', () => {
    process.env.INTERNAL_API_SECRET = 'legacy-secret';
    const backgroundContext = createBackgroundContext('test-suite', 'corr-test-123');

    const headers = runWithContext(backgroundContext, () =>
      buildLlmGatewayRequestHeaders({
        route: '/training/policy-gate/judge',
        tenantId: '11111111-1111-1111-1111-111111111111',
      })
    );

    expect(headers['x-correlation-id']).toBe('corr-test-123');
    expect(headers.traceparent).toBe(backgroundContext.traceparent);
    expect(headers['X-Internal-Api-Secret']).toBe('legacy-secret');
  });
});
