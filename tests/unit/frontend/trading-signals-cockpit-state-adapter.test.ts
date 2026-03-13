import { describe, expect, it } from 'vitest';
import {
  resolveSignalsCockpitReasonText,
  resolveSignalsCockpitStateBadge,
  resolveSignalsCockpitStateCategory,
} from '../../../apps/frontend-service/src/components/trading-v2/ai-signals-cockpit-state-adapter';

describe('trading signals cockpit state adapter', () => {
  it('classifica blocked de forma explícita', () => {
    const state = resolveSignalsCockpitStateCategory({
      hasLinkedSignal: true,
      linkedSignalApprovalStatus: 'pending',
      latestRunStatus: 'blocked',
    });
    expect(state).toBe('blocked');
    expect(resolveSignalsCockpitStateBadge(state).label).toBe('blocked');
  });

  it('classifica no_trade de forma explícita', () => {
    const state = resolveSignalsCockpitStateCategory({
      hasLinkedSignal: false,
      linkedSignalApprovalStatus: null,
      latestRunStatus: 'no_trade',
    });
    expect(state).toBe('no_trade');
    expect(resolveSignalsCockpitStateBadge(state).label).toBe('no_trade');
  });

  it('mantém compatibilidade com status legado success', () => {
    const state = resolveSignalsCockpitStateCategory({
      hasLinkedSignal: true,
      linkedSignalApprovalStatus: 'approved',
      latestRunStatus: 'success',
    });
    expect(state).toBe('executed');
  });

  it('prioriza explicação user-readable quando disponível', () => {
    const text = resolveSignalsCockpitReasonText('NO_EDGE', 'Sem edge para operar');
    expect(text).toBe('Sem edge para operar');
  });

  it('usa texto mapeado por reason code quando explanation não existe', () => {
    const text = resolveSignalsCockpitReasonText('CALIBRATION_MISSING', null);
    expect(text).toContain('Calibração estatística');
  });
});
