import { describe, expect, it } from 'vitest';
import { loadChatSource } from './helpers/chat-source';

describe('chat-service ws-token security guards', () => {
  it('keeps one-time-use ws-token nonce validation with redis', () => {
    const source = loadChatSource();
    expect(source.includes('WS_TOKEN_ONE_TIME_USE_REQUIRED')).toBe(true);
    expect(source.includes('WS_TOKEN_NONCE_REDIS_PREFIX')).toBe(true);
    expect(source.includes('async function consumeWsTokenNonce(')).toBe(true);
    expect(source.includes('redis.set(redisKey, \'1\', { NX: true, PX: ttlMs })')).toBe(true);
  });

  it('rejects /ws/chat handshake when token is invalid or nonce replay is detected', () => {
    const source = loadChatSource();
    expect(source.includes('WebSocket: token efemero rejeitado por one-time-use')).toBe(true);
    expect(source.includes("callback(false, 401, 'Unauthorized');")).toBe(true);
    expect(source.includes('WebSocket: token efemero invalido ou expirado')).toBe(true);
  });

  it('enforces nonce validation in /ws/agent token flow', () => {
    const source = loadChatSource();
    expect(source.includes('Conexao /ws/agent rejeitada por replay/invalidacao de ws-token')).toBe(true);
    expect(source.includes("authRejectedReason = 'invalid_token';")).toBe(true);
    expect(source.includes('wsTokenNonceValidationTotal.inc({ result: nonceValidation.result });')).toBe(true);
  });
});
