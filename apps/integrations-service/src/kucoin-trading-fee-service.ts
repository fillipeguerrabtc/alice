import { and, eq } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import { getRedisClient } from '@alice/shared-utils';
import type { IntegrationConfiguracao, TradingArbitrageExchange } from '@alice/shared';
import * as kucoinClient from './kucoinClient.js';
import * as kucoinMarginClient from './kucoinMarginClient.js';
import * as kucoinService from './kucoinService.js';
import * as kucoinSpotClient from './kucoinSpotClient.js';

type TradingMarketType = 'futures' | 'spot' | 'margin';

type KucoinTradingFeeCache = {
  spotPct?: number;
  marginPct?: number;
  futuresPct?: number;
  updatedAt: string;
};

type KucoinNetworkFeeCache = {
  feesByAsset: Record<string, number>;
  updatedAt: string;
};

type TradingFeeLogger = {
  debug: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

const TRADE_FEE_CACHE_TTL_SECONDS = 900; // 15 minutos
const TRADE_FEE_CACHE_PREFIX = 'alice:trading:fee';

export function createKucoinTradingFeeService(logger: TradingFeeLogger) {
  async function loadKucoinIntegrationConfig(tenantId: string): Promise<schema.Integration | null> {
    const integration = await getDatabase().query.integrations.findFirst({
      where: and(
        eq(schema.integrations.tenantId, tenantId),
        eq(schema.integrations.tipo, 'kucoin')
      ),
    });
    return integration ?? null;
  }

  async function updateKucoinIntegrationConfig(
    tenantId: string,
    patch: Partial<IntegrationConfiguracao>
  ): Promise<void> {
    const current = await loadKucoinIntegrationConfig(tenantId);
    if (!current) return;
    const nextConfig = {
      ...(current.configuracao ?? {}),
      ...patch,
    } as IntegrationConfiguracao;
    await getDatabase()
      .update(schema.integrations)
      .set({ configuracao: nextConfig, atualizadoEm: new Date() })
      .where(eq(schema.integrations.id, current.id));
  }

  function coerceFeeRateToPct(rate?: string | number): number | null {
    if (rate === undefined || rate === null) return null;
    const parsed = Number(String(rate).trim());
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed * 100;
  }

  function resolveNetworkFeeFromChains(chains: kucoinSpotClient.KucoinCurrencyChain[] | undefined): number | null {
    if (!Array.isArray(chains) || chains.length === 0) return null;
    const eligible = chains.filter((chain) => chain.isWithdrawEnabled !== false);
    if (eligible.length === 0) return null;
    const fees = eligible
      .map((chain) => Number(String(chain.withdrawalMinFee ?? chain.withdrawFeeRate ?? '').trim()))
      .filter((fee) => Number.isFinite(fee) && fee > 0);
    if (fees.length === 0) return null;
    return Math.max(...fees);
  }

  async function resolveKucoinNetworkFeesByAsset(): Promise<Record<string, number>> {
    const currencies = await kucoinSpotClient.getCurrencies();
    const feesByAsset: Record<string, number> = {};
    for (const currency of currencies) {
      const asset = currency.currency?.toUpperCase();
      if (!asset) continue;
      const fee = resolveNetworkFeeFromChains(currency.chains);
      if (fee === null) continue;
      feesByAsset[asset] = fee;
    }
    return feesByAsset;
  }

  async function resolveKucoinTradeFeePct(params: {
    symbol: string;
    marketType: TradingMarketType;
  }): Promise<number> {
    if (!kucoinService.validateSymbolFormatForMarket(params.symbol, params.marketType)) {
      throw new Error(
        `Formato de símbolo inválido para mercado ${params.marketType}: "${params.symbol}". ` +
        `Esperado: ${params.marketType === 'futures' ? 'XBTUSDTM (termina com M)' : 'BTC-USDT (base-quote com hífen)'}`
      );
    }

    const cacheKey = `${TRADE_FEE_CACHE_PREFIX}:${params.marketType}:${params.symbol}`;
    const redisClient = getRedisClient();
    if (redisClient) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          const cachedValue = parseFloat(cached);
          if (Number.isFinite(cachedValue) && cachedValue > 0) {
            logger.debug({ symbol: params.symbol, marketType: params.marketType, feePct: cachedValue }, 'Trade fee obtida do cache Redis');
            return cachedValue;
          }
        }
      } catch (cacheErr) {
        logger.warn({ error: (cacheErr as Error).message }, 'Erro ao ler cache de trade fees - continuando com API');
      }
    }

    let resolved: number;
    if (params.marketType === 'futures') {
      if (!kucoinClient.isKucoinConfigured()) {
        throw new Error('Credenciais KuCoin (Futures) não configuradas. Configure KUCOIN_PRO_API_KEY nos GitHub Secrets.');
      }
      const contract = await kucoinClient.getContractInfo(params.symbol);
      const makerPct = coerceFeeRateToPct(contract.makerFeeRate);
      const takerPct = coerceFeeRateToPct(contract.takerFeeRate);
      resolved = Math.max(makerPct ?? 0, takerPct ?? 0);
      if (!Number.isFinite(resolved) || resolved <= 0) {
        throw new Error('Taxas de trade Futures inválidas para KuCoin.');
      }
    } else {
      if (params.marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
        throw new Error('Credenciais KuCoin (Spot) não configuradas. Configure KUCOIN_PRO_API_KEY nos GitHub Secrets.');
      }
      if (params.marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
        throw new Error('Credenciais KuCoin (Margin) não configuradas. Configure KUCOIN_PRO_API_KEY nos GitHub Secrets.');
      }

      const fees = await kucoinSpotClient.getSpotTradeFees([params.symbol]);
      const fee = fees.find((item) => item.symbol === params.symbol);
      if (!fee) {
        const availableSymbols = fees.map((entry) => entry.symbol).join(', ');
        throw new Error(
          `Taxas de trade ${params.marketType === 'margin' ? 'Margin' : 'Spot'} não encontradas para símbolo ${params.symbol}. ` +
          `Símbolos disponíveis na resposta: ${availableSymbols || 'nenhum'}`
        );
      }
      const makerPct = coerceFeeRateToPct(fee.makerFeeRate);
      const takerPct = coerceFeeRateToPct(fee.takerFeeRate);
      resolved = Math.max(makerPct ?? 0, takerPct ?? 0);
      if (!Number.isFinite(resolved) || resolved <= 0) {
        throw new Error(`Taxas de trade ${params.marketType === 'margin' ? 'Margin' : 'Spot'} inválidas para KuCoin.`);
      }
    }

    if (redisClient) {
      try {
        await redisClient.set(cacheKey, String(resolved), { EX: TRADE_FEE_CACHE_TTL_SECONDS });
        logger.debug(
          { symbol: params.symbol, marketType: params.marketType, feePct: resolved, ttl: TRADE_FEE_CACHE_TTL_SECONDS },
          'Trade fee salva no cache Redis'
        );
      } catch (cacheErr) {
        logger.warn({ error: (cacheErr as Error).message }, 'Erro ao salvar trade fee no cache Redis');
      }
    }

    return resolved;
  }

  async function resolveArbitrageFeePctForExchanges(params: {
    exchanges: TradingArbitrageExchange[];
    symbol: string;
    marketType: TradingMarketType;
    tenantId: string;
  }): Promise<{ feePctByExchange: Record<TradingArbitrageExchange, number>; effectiveFeePct: number }> {
    const feePctByExchange = {} as Record<TradingArbitrageExchange, number>;
    const uniqueExchanges = Array.from(new Set(params.exchanges));
    const cachedIntegration = await loadKucoinIntegrationConfig(params.tenantId);
    const cachedFees =
      (cachedIntegration?.configuracao as IntegrationConfiguracao | undefined)?.tradingFees as KucoinTradingFeeCache | undefined;

    for (const exchange of uniqueExchanges) {
      if (exchange === 'kucoin') {
        try {
          const feePct = await resolveKucoinTradeFeePct({ symbol: params.symbol, marketType: params.marketType });
          feePctByExchange[exchange] = feePct;
          const nextCache: KucoinTradingFeeCache = {
            ...(cachedFees ?? {}),
            updatedAt: new Date().toISOString(),
          };
          if (params.marketType === 'spot') nextCache.spotPct = feePct;
          if (params.marketType === 'margin') nextCache.marginPct = feePct;
          if (params.marketType === 'futures') nextCache.futuresPct = feePct;
          await updateKucoinIntegrationConfig(params.tenantId, { tradingFees: nextCache });
        } catch (error) {
          const cachedValue = params.marketType === 'futures'
            ? cachedFees?.futuresPct
            : params.marketType === 'margin'
              ? cachedFees?.marginPct
              : cachedFees?.spotPct;
          if (Number.isFinite(cachedValue ?? NaN) && (cachedValue ?? 0) > 0) {
            feePctByExchange[exchange] = cachedValue as number;
            logger.warn({ error, exchange, cachedValue }, 'Usando taxa de trade KuCoin em cache persistido.');
          } else {
            throw error;
          }
        }
      }
    }

    const effectiveFeePct = Math.max(...Object.values(feePctByExchange));
    if (!Number.isFinite(effectiveFeePct) || effectiveFeePct <= 0) {
      throw new Error('Taxa de arbitragem inválida para exchanges selecionadas.');
    }
    return { feePctByExchange, effectiveFeePct };
  }

  async function resolveNetworkFeesForTenant(tenantId: string): Promise<Record<string, number>> {
    const cachedIntegration = await loadKucoinIntegrationConfig(tenantId);
    const cachedNetwork =
      (cachedIntegration?.configuracao as IntegrationConfiguracao | undefined)?.networkFeesByAsset as KucoinNetworkFeeCache | undefined;
    try {
      const networkFeesByAsset = await resolveKucoinNetworkFeesByAsset();
      await updateKucoinIntegrationConfig(tenantId, {
        networkFeesByAsset: {
          feesByAsset: networkFeesByAsset,
          updatedAt: new Date().toISOString(),
        } satisfies KucoinNetworkFeeCache,
      });
      return networkFeesByAsset;
    } catch (error) {
      if (cachedNetwork?.feesByAsset && Object.keys(cachedNetwork.feesByAsset).length > 0) {
        logger.warn({ error }, 'Usando network fees de KuCoin em cache persistido.');
        return cachedNetwork.feesByAsset;
      }
      throw error;
    }
  }

  return {
    resolveArbitrageFeePctForExchanges,
    resolveNetworkFeesForTenant,
  };
}
