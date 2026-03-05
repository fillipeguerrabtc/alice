import { describe, it, expect } from 'vitest';
import {
  loadWsAgentAuthGovernancePolicyFromEnv,
  resolveWsAgentAuthDecision,
  resolveWsAgentCloseFrame,
} from '../../apps/chat-service/src/ws-agent-auth-governance';

describe('ws-agent auth governance', () => {
  it('defaults to strict token requirement (fail-closed)', () => {
    const policy = loadWsAgentAuthGovernancePolicyFromEnv({});
    expect(policy.requireWsAgentToken).toBe(true);
    expect(policy.allowLegacySessionFallback).toBe(false);
  });

  it('ignores relaxed env flags and enforces strict token mode', () => {
    const policy = loadWsAgentAuthGovernancePolicyFromEnv({
      WS_AGENT_REQUIRE_TOKEN: 'false',
      WS_AGENT_ALLOW_LEGACY_SESSION_FALLBACK: 'true',
    });
    expect(policy.requireWsAgentToken).toBe(true);
    expect(policy.allowLegacySessionFallback).toBe(false);
  });

  it('keeps secure defaults for invalid env values', () => {
    const policy = loadWsAgentAuthGovernancePolicyFromEnv({
      WS_AGENT_REQUIRE_TOKEN: 'invalid',
      WS_AGENT_ALLOW_LEGACY_SESSION_FALLBACK: 'invalid',
    });
    expect(policy.requireWsAgentToken).toBe(true);
    expect(policy.allowLegacySessionFallback).toBe(false);
  });
});

describe('ws-agent auth decision resolver', () => {
  const strictPolicy = loadWsAgentAuthGovernancePolicyFromEnv({});
  const requestedRelaxedPolicy = loadWsAgentAuthGovernancePolicyFromEnv({
    WS_AGENT_REQUIRE_TOKEN: 'false',
    WS_AGENT_ALLOW_LEGACY_SESSION_FALLBACK: 'true',
  });

  it('accepts valid ws-agent token payload', () => {
    const decision = resolveWsAgentAuthDecision({
      hasWsToken: true,
      tokenPayloadValid: true,
      policy: strictPolicy,
    });
    expect(decision.shouldAcceptTokenPayload).toBe(true);
    expect(decision.shouldAttemptLegacySessionFallback).toBe(false);
    expect(decision.rejectReason).toBeNull();
  });

  it('rejects invalid token without allowing legacy fallback', () => {
    const decision = resolveWsAgentAuthDecision({
      hasWsToken: true,
      tokenPayloadValid: false,
      policy: requestedRelaxedPolicy,
    });
    expect(decision.shouldAcceptTokenPayload).toBe(false);
    expect(decision.shouldAttemptLegacySessionFallback).toBe(false);
    expect(decision.rejectReason).toBe('invalid_token');
  });

  it('requires token by default when none is provided', () => {
    const decision = resolveWsAgentAuthDecision({
      hasWsToken: false,
      tokenPayloadValid: false,
      policy: strictPolicy,
    });
    expect(decision.shouldAttemptLegacySessionFallback).toBe(false);
    expect(decision.rejectReason).toBe('missing_token');
  });

  it('requires token even when relaxed env flags are requested', () => {
    const decision = resolveWsAgentAuthDecision({
      hasWsToken: false,
      tokenPayloadValid: false,
      policy: requestedRelaxedPolicy,
    });
    expect(decision.shouldAcceptTokenPayload).toBe(false);
    expect(decision.shouldAttemptLegacySessionFallback).toBe(false);
    expect(decision.rejectReason).toBe('missing_token');
  });
});

describe('ws-agent close frame resolver', () => {
  it('returns explicit missing-token close reason', () => {
    const frame = resolveWsAgentCloseFrame('missing_token');
    expect(frame.code).toBe(4001);
    expect(frame.reason).toBe('Token ws-agent obrigatorio');
  });

  it('returns invalid-token close reason for other rejection reasons', () => {
    const invalidToken = resolveWsAgentCloseFrame('invalid_token');
    const unknown = resolveWsAgentCloseFrame('unknown');
    expect(invalidToken).toEqual({ code: 4001, reason: 'Token ws-agent invalido ou expirado' });
    expect(unknown).toEqual({ code: 4001, reason: 'Token ws-agent invalido ou expirado' });
  });
});
