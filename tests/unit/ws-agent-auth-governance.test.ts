import { describe, it, expect } from 'vitest';
import { loadWsAgentAuthGovernancePolicyFromEnv } from '../../apps/chat-service/src/ws-agent-auth-governance';

describe('ws-agent auth governance', () => {
  it('defaults to strict token requirement (fail-closed)', () => {
    const policy = loadWsAgentAuthGovernancePolicyFromEnv({});
    expect(policy.requireWsAgentToken).toBe(true);
    expect(policy.allowLegacySessionFallback).toBe(false);
  });

  it('enables controlled legacy fallback only when token is not mandatory', () => {
    const policy = loadWsAgentAuthGovernancePolicyFromEnv({
      WS_AGENT_REQUIRE_TOKEN: 'false',
    });
    expect(policy.requireWsAgentToken).toBe(false);
    expect(policy.allowLegacySessionFallback).toBe(true);
  });

  it('allows explicitly disabling legacy fallback in migration mode', () => {
    const policy = loadWsAgentAuthGovernancePolicyFromEnv({
      WS_AGENT_REQUIRE_TOKEN: 'false',
      WS_AGENT_ALLOW_LEGACY_SESSION_FALLBACK: 'false',
    });
    expect(policy.requireWsAgentToken).toBe(false);
    expect(policy.allowLegacySessionFallback).toBe(false);
  });

  it('never allows legacy fallback when strict token mode is active', () => {
    const policy = loadWsAgentAuthGovernancePolicyFromEnv({
      WS_AGENT_REQUIRE_TOKEN: 'true',
      WS_AGENT_ALLOW_LEGACY_SESSION_FALLBACK: 'true',
    });
    expect(policy.requireWsAgentToken).toBe(true);
    expect(policy.allowLegacySessionFallback).toBe(false);
  });

  it('falls back to secure defaults for invalid env values', () => {
    const policy = loadWsAgentAuthGovernancePolicyFromEnv({
      WS_AGENT_REQUIRE_TOKEN: 'invalid',
      WS_AGENT_ALLOW_LEGACY_SESSION_FALLBACK: 'invalid',
    });
    expect(policy.requireWsAgentToken).toBe(true);
    expect(policy.allowLegacySessionFallback).toBe(false);
  });
});
