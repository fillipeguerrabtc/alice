import { and, desc, eq, getDatabase, inArray, isNull, not, schema, sql } from '@alice/database';

type LoggerLike = {
  warn: (obj: Record<string, unknown>, message: string) => void;
  error: (obj: Record<string, unknown>, message: string) => void;
  info: (obj: Record<string, unknown>, message: string) => void;
};

type GaugeLike = {
  set: (value: number) => void;
};

type SymbolGaugeLike = {
  set: (labels: { symbol: string }, value: number) => void;
};

export function createTradingMetricsRuntimeService(deps: {
  logger: LoggerLike;
  tradingMetricsIntervalMs: number;
  tradingPnlWindowHours: number;
  getAllowedSymbols: () => Promise<string[]>;
  tradingPnlRealizedUsd: GaugeLike;
  tradingPnlUnrealizedUsd: GaugeLike;
  tradingOrdersActive: GaugeLike;
  tradingRsiGauge: SymbolGaugeLike;
  tradingBollingerUpper: SymbolGaugeLike;
  tradingBollingerMiddle: SymbolGaugeLike;
  tradingBollingerLower: SymbolGaugeLike;
  tradingPriceUsd: SymbolGaugeLike;
}) {
  let tradingMetricsInterval: NodeJS.Timeout | null = null;

  function resolveTradingMetricsInterval(): number {
    if (!Number.isFinite(deps.tradingMetricsIntervalMs) || deps.tradingMetricsIntervalMs < 10000) {
      deps.logger.warn({ TRADING_METRICS_INTERVAL_MS: deps.tradingMetricsIntervalMs }, 'TRADING_METRICS_INTERVAL_MS inválido, usando 60000ms');
      return 60000;
    }
    return deps.tradingMetricsIntervalMs;
  }

  function resolveTradingPnlWindowHours(): number {
    if (!Number.isFinite(deps.tradingPnlWindowHours) || deps.tradingPnlWindowHours <= 0) {
      deps.logger.warn({ TRADING_PNL_WINDOW_HOURS: deps.tradingPnlWindowHours }, 'TRADING_PNL_WINDOW_HOURS inválido, usando 24h');
      return 24;
    }
    return deps.tradingPnlWindowHours;
  }

  async function refreshTradingMetrics(): Promise<void> {
    try {
      const db = getDatabase();
      const pnlWindowHours = resolveTradingPnlWindowHours();
      const since = new Date(Date.now() - pnlWindowHours * 60 * 60 * 1000);

      const [realizedPnl] = await db
        .select({ value: sql<number>`COALESCE(SUM(${schema.tradingPositions.realizedPnl}), 0)` })
        .from(schema.tradingPositions)
        .where(
          and(
            not(isNull(schema.tradingPositions.closedAt)),
            sql`${schema.tradingPositions.closedAt} >= ${since}`,
          ),
        );

      const [unrealizedPnl] = await db
        .select({ value: sql<number>`COALESCE(SUM(${schema.tradingPositions.unrealizedPnl}), 0)` })
        .from(schema.tradingPositions)
        .where(eq(schema.tradingPositions.status, 'open'));

      const [ordersActive] = await db
        .select({ value: sql<number>`count(*)` })
        .from(schema.tradingOrders)
        .where(inArray(schema.tradingOrders.status, ['pending', 'submitted', 'open']));

      deps.tradingPnlRealizedUsd.set(Number(realizedPnl?.value ?? 0));
      deps.tradingPnlUnrealizedUsd.set(Number(unrealizedPnl?.value ?? 0));
      deps.tradingOrdersActive.set(Number(ordersActive?.value ?? 0));

      const symbols = await deps.getAllowedSymbols();
      for (const symbol of symbols) {
        const latest = await db.query.tradingTechnicalIndicators.findFirst({
          where: eq(schema.tradingTechnicalIndicators.symbol, symbol),
          orderBy: [desc(schema.tradingTechnicalIndicators.calculatedAt)],
        });

        if (!latest) {
          continue;
        }

        if (Number.isFinite(latest.rsiValue ?? Number.NaN)) {
          deps.tradingRsiGauge.set({ symbol }, Number(latest.rsiValue));
        }
        if (Number.isFinite(latest.bollingerUpper ?? Number.NaN)) {
          deps.tradingBollingerUpper.set({ symbol }, Number(latest.bollingerUpper));
        }
        if (Number.isFinite(latest.bollingerMiddle ?? Number.NaN)) {
          deps.tradingBollingerMiddle.set({ symbol }, Number(latest.bollingerMiddle));
        }
        if (Number.isFinite(latest.bollingerLower ?? Number.NaN)) {
          deps.tradingBollingerLower.set({ symbol }, Number(latest.bollingerLower));
        }
        if (Number.isFinite(latest.currentPrice ?? Number.NaN)) {
          deps.tradingPriceUsd.set({ symbol }, Number(latest.currentPrice));
        }
      }
    } catch (error) {
      deps.logger.error({ error }, 'Falha ao atualizar métricas de trading');
    }
  }

  function startTradingMetricsScheduler(): void {
    void refreshTradingMetrics();
    const intervalMs = resolveTradingMetricsInterval();
    tradingMetricsInterval = setInterval(() => {
      void refreshTradingMetrics();
    }, intervalMs);
    deps.logger.info({ intervalMs }, 'Scheduler de métricas de trading iniciado');
  }

  function stopTradingMetricsScheduler(): void {
    if (tradingMetricsInterval) {
      clearInterval(tradingMetricsInterval);
      tradingMetricsInterval = null;
    }
  }

  return {
    refreshTradingMetrics,
    startTradingMetricsScheduler,
    stopTradingMetricsScheduler,
  };
}
