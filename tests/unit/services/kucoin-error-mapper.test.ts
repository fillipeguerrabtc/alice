/**
 * Testes unitários — KuCoin Error Mapper (Integrations Service)
 *
 * Objetivo: garantir mapeamento determinístico KuCoin → HTTP sem depender de mocks externos.
 *
 * Author: Fillipe Guerra
 * Data: 15/01/2026
 */

import { describe, it, expect } from 'vitest';
import { KucoinRequestError } from '../../../apps/integrations-service/src/kucoinClient.js';
import { mapKucoinErrorToHttpResponse } from '../../../apps/integrations-service/src/kucoin-error-mapper.js';

const TEST_SYMBOL = 'SYMBOL_TEST';

describe('Integrations Service - KuCoin Error Mapper', () => {
  it('deve retornar null para erro não-KuCoin', () => {
    const mapped = mapKucoinErrorToHttpResponse(new Error('x'), { isProduction: true });
    expect(mapped).toBeNull();
  });

  it('deve mapear breaker_open → 503', () => {
    const err = new KucoinRequestError({
      kind: 'breaker_open',
      method: 'GET',
      endpoint: `/api/v1/ticker?symbol=${TEST_SYMBOL}`,
      message: 'Circuit breaker aberto',
    });
    const mapped = mapKucoinErrorToHttpResponse(err, { isProduction: true });
    expect(mapped?.status).toBe(503);
  });

  it('deve mapear timeout → 504', () => {
    const err = new KucoinRequestError({
      kind: 'timeout',
      method: 'GET',
      endpoint: `/api/v1/ticker?symbol=${TEST_SYMBOL}`,
      message: 'timeout',
    });
    const mapped = mapKucoinErrorToHttpResponse(err, { isProduction: true });
    expect(mapped?.status).toBe(504);
  });

  it('deve mapear HTTP 429 → 429 e setar Retry-After (ceil)', () => {
    const err = new KucoinRequestError({
      kind: 'http',
      method: 'GET',
      endpoint: `/api/v1/ticker?symbol=${TEST_SYMBOL}`,
      status: 429,
      retryAfterMs: 4500,
      message: 'KuCoin HTTP 429',
    });
    const mapped = mapKucoinErrorToHttpResponse(err, { isProduction: true });
    expect(mapped?.status).toBe(429);
    expect(mapped?.headers?.['Retry-After']).toBe('5');
  });

  it('deve mapear HTTP 401/403 → 503', () => {
    const err401 = new KucoinRequestError({
      kind: 'http',
      method: 'GET',
      endpoint: '/api/v1/account-overview',
      status: 401,
      message: 'KuCoin HTTP 401',
    });
    const err403 = new KucoinRequestError({
      kind: 'http',
      method: 'GET',
      endpoint: '/api/v1/account-overview',
      status: 403,
      message: 'KuCoin HTTP 403',
    });
    expect(mapKucoinErrorToHttpResponse(err401, { isProduction: true })?.status).toBe(503);
    expect(mapKucoinErrorToHttpResponse(err403, { isProduction: true })?.status).toBe(503);
  });

  it('deve mapear HTTP 5xx upstream → 502', () => {
    const err = new KucoinRequestError({
      kind: 'http',
      method: 'GET',
      endpoint: `/api/v1/ticker?symbol=${TEST_SYMBOL}`,
      status: 503,
      message: 'KuCoin HTTP 503',
    });
    const mapped = mapKucoinErrorToHttpResponse(err, { isProduction: true });
    expect(mapped?.status).toBe(502);
  });

  it('deve mapear network/parse/api → 502', () => {
    const kinds = ['network', 'parse', 'api'] as const;
    for (const kind of kinds) {
      const err = new KucoinRequestError({
        kind,
        method: 'GET',
        endpoint: `/api/v1/ticker?symbol=${TEST_SYMBOL}`,
        message: 'x',
      });
      expect(mapKucoinErrorToHttpResponse(err, { isProduction: true })?.status).toBe(502);
    }
  });

  it('em dev/test deve incluir details', () => {
    const err = new KucoinRequestError({
      kind: 'http',
      method: 'GET',
      endpoint: `/api/v1/ticker?symbol=${TEST_SYMBOL}`,
      status: 429,
      retryAfterMs: 1000,
      message: 'KuCoin HTTP 429',
    });
    const mapped = mapKucoinErrorToHttpResponse(err, { isProduction: false });
    expect(mapped?.body).toHaveProperty('details');
  });

  it('em produção não deve incluir details', () => {
    const err = new KucoinRequestError({
      kind: 'http',
      method: 'GET',
      endpoint: `/api/v1/ticker?symbol=${TEST_SYMBOL}`,
      status: 429,
      retryAfterMs: 1000,
      message: 'KuCoin HTTP 429',
    });
    const mapped = mapKucoinErrorToHttpResponse(err, { isProduction: true });
    expect(mapped?.body).not.toHaveProperty('details');
  });
});

