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
    | null;
};

export type WsAgentCloseFrame = {
  code: number;
  reason: string;
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
  const requestedRequireToken = parseEnvBoolean(env.WS_AGENT_REQUIRE_TOKEN, true);
  const requestedLegacyFallback = parseEnvBoolean(env.WS_AGENT_ALLOW_LEGACY_SESSION_FALLBACK, false);

  void requestedRequireToken;
  void requestedLegacyFallback;

  return {
    // Enterprise fail-closed: /ws/agent always requires explicit ws-agent token.
    requireWsAgentToken: true,
    allowLegacySessionFallback: false,
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

  return {
    shouldAcceptTokenPayload: false,
    shouldAttemptLegacySessionFallback: false,
    rejectReason: params.policy.requireWsAgentToken ? 'missing_token' : 'invalid_token',
  };
}

export function resolveWsAgentCloseFrame(
  rejectReason: WsAgentAuthDecision['rejectReason'] | 'unknown'
): WsAgentCloseFrame {
  if (rejectReason === 'missing_token') {
    return { code: 4001, reason: 'Token ws-agent obrigatorio' };
  }

  return { code: 4001, reason: 'Token ws-agent invalido ou expirado' };
}
