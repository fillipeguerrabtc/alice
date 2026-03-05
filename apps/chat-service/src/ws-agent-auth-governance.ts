export type WsAgentAuthGovernancePolicy = {
  requireWsAgentToken: boolean;
  allowLegacySessionFallback: boolean;
};

export type WsAgentAuthDecision = {
  shouldAcceptTokenPayload: boolean;
  shouldAttemptLegacySessionFallback: boolean;
  rejectReason:
    | 'missing_token'
    | 'invalid_token'
    | 'missing_token_fallback_disabled'
    | null;
};

function parseEnvBoolean(rawValue: string | undefined, defaultValue: boolean): boolean {
  if (typeof rawValue === 'undefined') return defaultValue;
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return defaultValue;
}

export function loadWsAgentAuthGovernancePolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env
): WsAgentAuthGovernancePolicy {
  const requireWsAgentToken = parseEnvBoolean(env.WS_AGENT_REQUIRE_TOKEN, true);
  const allowLegacySessionFallback =
    !requireWsAgentToken &&
    parseEnvBoolean(env.WS_AGENT_ALLOW_LEGACY_SESSION_FALLBACK, true);

  return {
    requireWsAgentToken,
    allowLegacySessionFallback,
  };
}

export function resolveWsAgentAuthDecision(params: {
  hasWsToken: boolean;
  tokenPayloadValid: boolean;
  policy: WsAgentAuthGovernancePolicy;
}): WsAgentAuthDecision {
  if (params.hasWsToken) {
    if (params.tokenPayloadValid) {
      return {
        shouldAcceptTokenPayload: true,
        shouldAttemptLegacySessionFallback: false,
        rejectReason: null,
      };
    }
    return {
      shouldAcceptTokenPayload: false,
      shouldAttemptLegacySessionFallback: false,
      rejectReason: 'invalid_token',
    };
  }

  if (params.policy.allowLegacySessionFallback) {
    return {
      shouldAcceptTokenPayload: false,
      shouldAttemptLegacySessionFallback: true,
      rejectReason: null,
    };
  }

  if (params.policy.requireWsAgentToken) {
    return {
      shouldAcceptTokenPayload: false,
      shouldAttemptLegacySessionFallback: false,
      rejectReason: 'missing_token',
    };
  }

  return {
    shouldAcceptTokenPayload: false,
    shouldAttemptLegacySessionFallback: false,
    rejectReason: 'missing_token_fallback_disabled',
  };
}
