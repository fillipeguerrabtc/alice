import type { TradingSignalPromotionPathSummary } from '@/services/api/trading';

export type TradingCockpitDirectionalSignalType = 'entry_long' | 'entry_short';

export type TradingCockpitSignalForDemoHandoff = {
  id: string;
  signalType: 'entry_long' | 'entry_short' | 'exit' | 'adjust_sl' | 'adjust_tp' | 'hold' | 'neutral';
  symbol: string;
  suggestedStopLoss?: number | null;
  suggestedTakeProfit?: number | null;
};

export type TradingDemoHandoffDraft = {
  sizeInput: string;
  leverageInput: string;
  entryType: 'market' | 'limit';
  priceInput: string;
};

export type TradingDemoHandoffPayload = {
  signalId: string;
  symbol: string;
  side: 'buy' | 'sell';
  size: number;
  leverage?: number;
  entryType: 'market' | 'limit';
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
};

export type TradingDemoHandoffBuildResult =
  | { ok: true; payload: TradingDemoHandoffPayload }
  | { ok: false; code: 'NON_DIRECTIONAL_SIGNAL' | 'INVALID_SIZE' | 'LIMIT_PRICE_REQUIRED' };

export function parsePositiveNumber(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function isDirectionalSignalType(signalType: TradingCockpitSignalForDemoHandoff['signalType']): signalType is TradingCockpitDirectionalSignalType {
  return signalType === 'entry_long' || signalType === 'entry_short';
}

export function buildTradingDemoHandoffPayload(params: {
  draft: TradingDemoHandoffDraft;
  signal: TradingCockpitSignalForDemoHandoff;
}): TradingDemoHandoffBuildResult {
  if (!isDirectionalSignalType(params.signal.signalType)) {
    return { ok: false, code: 'NON_DIRECTIONAL_SIGNAL' };
  }

  const parsedSize = parsePositiveNumber(params.draft.sizeInput);
  if (parsedSize == null) {
    return { ok: false, code: 'INVALID_SIZE' };
  }

  const parsedLeverage = parsePositiveNumber(params.draft.leverageInput);
  const parsedPrice = parsePositiveNumber(params.draft.priceInput);
  if (params.draft.entryType === 'limit' && parsedPrice == null) {
    return { ok: false, code: 'LIMIT_PRICE_REQUIRED' };
  }

  return {
    ok: true,
    payload: {
      signalId: params.signal.id,
      symbol: params.signal.symbol,
      side: params.signal.signalType === 'entry_long' ? 'buy' : 'sell',
      size: parsedSize,
      leverage: parsedLeverage ?? undefined,
      entryType: params.draft.entryType,
      price: params.draft.entryType === 'limit' ? parsedPrice ?? undefined : undefined,
      stopLoss: params.signal.suggestedStopLoss ?? undefined,
      takeProfit: params.signal.suggestedTakeProfit ?? undefined,
    },
  };
}

export function resolveTradingDemoEligibility(params: {
  promotionPath: TradingSignalPromotionPathSummary | null;
}): { eligible: boolean; reasonCode: string | null; reasonHuman: string } {
  const { promotionPath } = params;
  if (!promotionPath) {
    return {
      eligible: true,
      reasonCode: null,
      reasonHuman: 'Sem bloqueio ativo para handoff demo.',
    };
  }

  if (promotionPath.demo.status === 'eligible') {
    return {
      eligible: true,
      reasonCode: null,
      reasonHuman: 'Sem bloqueio ativo para handoff demo.',
    };
  }

  return {
    eligible: false,
    reasonCode: promotionPath.demo.reasonCode ?? null,
    reasonHuman: promotionPath.demo.reasonHuman ?? 'Elegibilidade demo bloqueada por policy.',
  };
}
