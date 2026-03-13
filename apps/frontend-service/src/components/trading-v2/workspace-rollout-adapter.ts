export type TradingWorkspaceFeatureFlagsLike = Record<string, unknown> | null | undefined;

function readBooleanFlag(featureFlags: Record<string, unknown>, key: string): boolean | null {
  const value = featureFlags[key];
  return typeof value === 'boolean' ? value : null;
}

export function isTradingWorkspaceV2Enabled(featureFlags: TradingWorkspaceFeatureFlagsLike): boolean {
  if (!featureFlags || typeof featureFlags !== 'object' || Array.isArray(featureFlags)) {
    return false;
  }

  const direct = readBooleanFlag(featureFlags, 'tradingWorkspaceV2Enabled');
  if (direct != null) {
    return direct;
  }

  // Compatibilidade para consumers legados de contract.
  const legacySnakeCase = readBooleanFlag(featureFlags, 'trading_workspace_v2_enabled');
  if (legacySnakeCase != null) {
    return legacySnakeCase;
  }

  const legacyShort = readBooleanFlag(featureFlags, 'tradingV2Enabled');
  return legacyShort ?? false;
}
