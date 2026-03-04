export type WsAgentAuthGovernancePolicy = {
  requireWsAgentToken: boolean;
  allowLegacySessionFallback: boolean;
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
