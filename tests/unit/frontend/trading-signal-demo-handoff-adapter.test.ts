import { describe, expect, it } from 'vitest';
import {
  buildTradingDemoHandoffPayload,
  resolveTradingDemoEligibility,
} from '../../../apps/frontend-service/src/components/trading-v2/ai-signals-demo-handoff-adapter';
import type { TradingSignalPromotionPathSummary } from '../../../apps/frontend-service/src/services/api/trading';

describe('trading signal demo handoff adapter', () => {
  it('constrói payload válido para sinal direcional', () => {
    const result = buildTradingDemoHandoffPayload({
      draft: {
        sizeInput: '0.25',
        leverageInput: '3',
        entryType: 'limit',
        priceInput: '92000',
      },
      signal: {
        id: 'signal-1',
        signalType: 'entry_long',
        symbol: 'BTCUSDTM',
        suggestedStopLoss: 88000,
        suggestedTakeProfit: 97000,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.side).toBe('buy');
    expect(result.payload.size).toBe(0.25);
    expect(result.payload.price).toBe(92000);
  });

  it('bloqueia payload para sinal não direcional', () => {
    const result = buildTradingDemoHandoffPayload({
      draft: {
        sizeInput: '1',
        leverageInput: '',
        entryType: 'market',
        priceInput: '',
      },
      signal: {
        id: 'signal-2',
        signalType: 'neutral',
        symbol: 'BTCUSDTM',
      },
    });

    expect(result).toEqual({ ok: false, code: 'NON_DIRECTIONAL_SIGNAL' });
  });

  it('bloqueia limit sem preço positivo', () => {
    const result = buildTradingDemoHandoffPayload({
      draft: {
        sizeInput: '1',
        leverageInput: '',
        entryType: 'limit',
        priceInput: '',
      },
      signal: {
        id: 'signal-3',
        signalType: 'entry_short',
        symbol: 'ETHUSDTM',
      },
    });

    expect(result).toEqual({ ok: false, code: 'LIMIT_PRICE_REQUIRED' });
  });

  it('resolve elegibilidade demo com fallback seguro quando não há promotion path', () => {
    const eligibility = resolveTradingDemoEligibility({ promotionPath: null });
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.reasonCode).toBeNull();
  });

  it('resolve bloqueio demo com reason code/human legíveis', () => {
    const promotionPath = {
      demo: {
        status: 'blocked',
        reasonCode: 'CALIBRATION_MISSING',
        reasonHuman: 'Calibração pendente.',
      },
    } as unknown as TradingSignalPromotionPathSummary;

    const eligibility = resolveTradingDemoEligibility({
      promotionPath,
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasonCode).toBe('CALIBRATION_MISSING');
    expect(eligibility.reasonHuman).toBe('Calibração pendente.');
  });
});
