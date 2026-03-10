import type { Request, Response } from 'express';
import { z } from 'zod';
import { extractAuthContext } from '@alice/shared-utils';
import { tradingIntervalEnum } from '@alice/shared';
import * as kucoinClient from './kucoinClient.js';
import * as kucoinSpotClient from './kucoinSpotClient.js';
import * as kucoinMarginClient from './kucoinMarginClient.js';
import {
  getAllowedGranularitiesMinutes,
  KUCOIN_REST_ORDERBOOK_DEPTHS,
  parseTradingIntervalToMinutes,
  resolveKucoinRestOrderBookDepth,
} from './kucoin-ws-config-service.js';

type TradingAuth = { tenantId: string; userId: string };
type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';

type TradingLogger = {
  error: (payload: unknown, message: string) => void;
};

type ResolveMarketTypeInput = {
  marketType?: TradingMarketType;
  type?: TradingMarketType;
};

type ResolveTradingSymbolOptions = {
  required?: boolean;
  marketType?: TradingMarketType;
  marginMode?: TradingMarginMode;
};

type CreateTradingMarketDataHandlersParams = {
  logger: TradingLogger;
  resolveMarketTypeParam: (params: ResolveMarketTypeInput) => TradingMarketType | undefined;
  respondKucoinNotConfigured: (res: Response) => void;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
  resolveTradingSymbolOrRespond: (
    res: Response,
    tradingAuth: TradingAuth,
    symbol: string | undefined,
    options?: ResolveTradingSymbolOptions,
  ) => Promise<string | undefined>;
};

export function createTradingMarketDataHandlers(params: CreateTradingMarketDataHandlersParams) {
  const {
    logger,
    resolveMarketTypeParam,
    respondKucoinNotConfigured,
    sendKucoinErrorResponse,
    resolveTradingSymbolOrRespond,
  } = params;

  async function handleTradingKlinesRequest(
    req: Request,
    res: Response,
    symbol: string | undefined,
    required = true
  ): Promise<void> {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

      const defaultInterval = tradingIntervalEnum.enumValues[0];
      const defaultGranularity = defaultInterval ? parseTradingIntervalToMinutes(defaultInterval) : null;
      const allowedGranularities = getAllowedGranularitiesMinutes();
      if (!defaultGranularity) {
        throw new Error('Intervalo padrão inválido para klines');
      }

      const querySchema = z.object({
        granularity: z.coerce.number().int().optional(),
        from: z.coerce.number().int().optional(),
        to: z.coerce.number().int().optional(),
        marketType: z.enum(['futures', 'spot', 'margin']).optional(),
        type: z.enum(['futures', 'spot', 'margin']).optional(),
        marginMode: z.enum(['cross', 'isolated']).optional(),
      }).superRefine((data, ctx) => {
        const granularity = data.granularity ?? defaultGranularity;
        if (!allowedGranularities.includes(granularity)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `granularity inválido. Valores permitidos (minutos): ${allowedGranularities.join(', ')}`,
            path: ['granularity'],
          });
        }
        if (data.from !== undefined && data.to !== undefined && data.from > data.to) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: '"from" deve ser <= "to".',
            path: ['from'],
          });
        }
        if (data.from !== undefined && data.to !== undefined) {
          const intervalMs = granularity * 60 * 1000;
          const points = Math.floor((data.to - data.from) / intervalMs) + 1;
          if (points > 500) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Intervalo excede o limite de 500 klines por requisição. Divida o período.',
              path: ['from'],
            });
          }
        }
      });

      const queryResult = querySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }

      const granularity = queryResult.data.granularity ?? defaultGranularity;
      const from = queryResult.data.from;
      const to = queryResult.data.to;
      const marketType = resolveMarketTypeParam(queryResult.data);
      const marginMode = queryResult.data.marginMode;

      if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
      if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
      if (!marketType || marketType === 'futures') {
        if (!kucoinClient.isKucoinConfigured()) {
          respondKucoinNotConfigured(res);
          return;
        }
      }

      const resolvedSymbol = await resolveTradingSymbolOrRespond(res, tradingAuth, symbol, { required, marketType, marginMode });
      if (!resolvedSymbol) return;

      const klines = marketType === 'spot' || marketType === 'margin'
        ? await kucoinSpotClient.getSpotKlines(
            resolvedSymbol,
            `${granularity}min`,
            from ? Math.floor(from / 1000) : undefined,
            to ? Math.floor(to / 1000) : undefined
          )
        : await kucoinClient.getKlines(resolvedSymbol, granularity, from, to);

      res.json({
        success: true,
        data: klines,
        symbol: resolvedSymbol,
        granularity,
        interval: kucoinClient.granularityToInterval(granularity),
      });
    } catch (error) {
      if (sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter klines');
      res.status(500).json({ error: errorMessage });
    }
  }

  async function handleTradingOrderBookRequest(
    req: Request,
    res: Response,
    symbol: string | undefined,
    required = true
  ): Promise<void> {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

      const defaultDepth = resolveKucoinRestOrderBookDepth();
      const querySchema = z.object({
        depth: z.coerce.number().int().optional(),
        marketType: z.enum(['futures', 'spot', 'margin']).optional(),
        type: z.enum(['futures', 'spot', 'margin']).optional(),
        marginMode: z.enum(['cross', 'isolated']).optional(),
      }).superRefine((data, ctx) => {
        const depth = data.depth ?? defaultDepth;
        if (!KUCOIN_REST_ORDERBOOK_DEPTHS.includes(depth as (typeof KUCOIN_REST_ORDERBOOK_DEPTHS)[number])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'depth inválido. Valores permitidos: 20.',
            path: ['depth'],
          });
        }
      });

      const queryResult = querySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }

      const depth = (queryResult.data.depth ?? defaultDepth) as 20;
      const marketType = resolveMarketTypeParam(queryResult.data);
      const marginMode = queryResult.data.marginMode;

      if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
      if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
      if (!marketType || marketType === 'futures') {
        if (!kucoinClient.isKucoinConfigured()) {
          respondKucoinNotConfigured(res);
          return;
        }
      }

      const resolvedSymbol = await resolveTradingSymbolOrRespond(res, tradingAuth, symbol, { required, marketType, marginMode });
      if (!resolvedSymbol) return;

      const orderbook = marketType === 'spot' || marketType === 'margin'
        ? await kucoinSpotClient.getSpotOrderBook(resolvedSymbol)
        : await kucoinClient.getOrderBook(resolvedSymbol, depth);

      res.json({
        success: true,
        data: orderbook,
        symbol: resolvedSymbol,
        depth,
      });
    } catch (error) {
      if (sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter order book');
      res.status(500).json({ error: errorMessage });
    }
  }

  return {
    handleTradingKlinesRequest,
    handleTradingOrderBookRequest,
  };
}
