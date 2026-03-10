import type { Request, Response } from 'express';
import * as kucoinService from './kucoinService.js';

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';

type ResolveTradingSymbolOptions = {
  required?: boolean;
  marketType?: TradingMarketType;
  marginMode?: TradingMarginMode;
};

type ResolveMarketTypeParams = {
  marketType?: TradingMarketType;
  type?: TradingMarketType;
};

type TradingRequestResolverParams = {
  tradingIntervalGranularity: Record<string, number>;
};

export function createTradingRequestResolver(params: TradingRequestResolverParams) {
  const { tradingIntervalGranularity } = params;

  function respondKucoinNotConfigured(res: Response): void {
    res.status(503).json({ error: 'API KuCoin não configurada' });
  }

  async function resolveTradingSymbolOrRespond(
    res: Response,
    authContext: { tenantId: string; userId: string },
    symbol?: string,
    options: ResolveTradingSymbolOptions = {}
  ): Promise<string | undefined> {
    if (options.required && !symbol) {
      res.status(400).json({ error: 'Símbolo é obrigatório para esta operação.' });
      return undefined;
    }

    try {
      return options.required
        ? await kucoinService.resolveTradingSymbolStrict(authContext, symbol, options.marketType, options.marginMode)
        : await kucoinService.resolveTradingSymbol(authContext, symbol, options.marketType, options.marginMode);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Símbolo inválido';
      res.status(400).json({ error: errorMessage });
      return undefined;
    }
  }

  function resolveMarketTypeParam(params: ResolveMarketTypeParams): TradingMarketType | undefined {
    return params.marketType ?? params.type;
  }

  function resolveSymbolFromQuery(req: Request): string | undefined {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : undefined;
    return symbol || undefined;
  }

  function resolveTradingIntervalGranularity(interval: string): number | null {
    if (interval in tradingIntervalGranularity) {
      return tradingIntervalGranularity[interval] ?? null;
    }
    return null;
  }

  return {
    respondKucoinNotConfigured,
    resolveTradingSymbolOrRespond,
    resolveMarketTypeParam,
    resolveSymbolFromQuery,
    resolveTradingIntervalGranularity,
  };
}
