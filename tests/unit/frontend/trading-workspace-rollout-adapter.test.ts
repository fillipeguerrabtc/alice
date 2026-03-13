import { describe, expect, it } from 'vitest';
import { isTradingWorkspaceV2Enabled } from '../../../apps/frontend-service/src/components/trading-v2/workspace-rollout-adapter';

describe('trading workspace rollout adapter', () => {
  it('ativa V2 quando feature flag canônica está true', () => {
    expect(isTradingWorkspaceV2Enabled({ tradingWorkspaceV2Enabled: true })).toBe(true);
  });

  it('mantém fallback legacy quando feature flag está false', () => {
    expect(isTradingWorkspaceV2Enabled({ tradingWorkspaceV2Enabled: false })).toBe(false);
  });

  it('aceita compatibilidade com chave snake_case legada', () => {
    expect(isTradingWorkspaceV2Enabled({ trading_workspace_v2_enabled: true })).toBe(true);
  });

  it('aceita compatibilidade com chave curta legada', () => {
    expect(isTradingWorkspaceV2Enabled({ tradingV2Enabled: true })).toBe(true);
  });

  it('fail-closed para payload inválido', () => {
    expect(isTradingWorkspaceV2Enabled(null)).toBe(false);
    expect(isTradingWorkspaceV2Enabled(undefined)).toBe(false);
    expect(isTradingWorkspaceV2Enabled({})).toBe(false);
  });
});
