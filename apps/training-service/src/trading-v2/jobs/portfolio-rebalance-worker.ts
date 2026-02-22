import { and, desc, eq, getDatabase, inArray, schema } from '@alice/database';

type RebalancePayload = {
  tenantId: string;
  portfolioId: string;
  asofTimestamp: string;
  inputs: Record<string, unknown>;
  decisions: Record<string, unknown>;
};

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return values.reduce((sum, value) => sum + ((value - m) ** 2), 0) / values.length;
}

function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  const av = a.slice(-n);
  const bv = b.slice(-n);
  const ma = mean(av);
  const mb = mean(bv);
  return av.reduce((sum, value, index) => sum + ((value - ma) * (bv[index] - mb)), 0) / n;
}

export async function runPortfolioRebalanceWorker(payload: RebalancePayload) {
  const db = getDatabase();
  const portfolio = await db.query.tradingPortfolios.findFirst({
    where: and(
      eq(schema.tradingPortfolios.id, payload.portfolioId),
      eq(schema.tradingPortfolios.tenantId, payload.tenantId),
    ),
  });
  if (!portfolio) {
    throw new Error('Portfólio não encontrado para rebalance');
  }

  const allocations = await db.query.tradingPortfolioAllocations.findMany({
    where: and(
      eq(schema.tradingPortfolioAllocations.tenantId, payload.tenantId),
      eq(schema.tradingPortfolioAllocations.portfolioId, payload.portfolioId),
      eq(schema.tradingPortfolioAllocations.enabled, true),
    ),
  });
  if (allocations.length === 0) {
    await db.insert(schema.tradingPortfolioRebalances).values({
      tenantId: payload.tenantId,
      portfolioId: payload.portfolioId,
      asofTimestamp: new Date(payload.asofTimestamp),
      inputs: payload.inputs,
      decisions: { reason: 'no_enabled_allocations' },
      status: 'failed',
    });
    return;
  }

  const instrumentIds = allocations.map((allocation) => allocation.instrumentId);
  const snapshots = await db.query.tradingFactorSnapshotsV2.findMany({
    where: and(
      eq(schema.tradingFactorSnapshotsV2.tenantId, payload.tenantId),
      inArray(schema.tradingFactorSnapshotsV2.instrumentId, instrumentIds),
    ),
    orderBy: [desc(schema.tradingFactorSnapshotsV2.candleTimestamp)],
    limit: 500,
  });

  const returnsByInstrument = new Map<string, number[]>();
  for (const snapshot of snapshots) {
    const current = returnsByInstrument.get(snapshot.instrumentId) ?? [];
    if (current.length < 80) {
      current.push(Number(snapshot.expectedReturn ?? 0));
      returnsByInstrument.set(snapshot.instrumentId, current);
    }
  }

  const targetVol = 0.02;
  const baseGrossLimit = Number(portfolio.maxGrossExposure ?? 0.8);
  const covarianceMatrix: Record<string, Record<string, number>> = {};
  for (const left of instrumentIds) {
    covarianceMatrix[left] = {};
    for (const right of instrumentIds) {
      const leftSeries = returnsByInstrument.get(left) ?? [];
      const rightSeries = returnsByInstrument.get(right) ?? [];
      const rawCov = covariance(leftSeries, rightSeries);
      const leftVariance = variance(leftSeries);
      const shrunk = (left === right)
        ? ((1 - 0.2) * rawCov) + (0.2 * leftVariance)
        : ((1 - 0.2) * rawCov);
      covarianceMatrix[left][right] = shrunk;
    }
  }

  const instruments = await db.query.tradingInstruments.findMany({
    where: inArray(schema.tradingInstruments.id, instrumentIds),
  });
  const instrumentById = new Map(instruments.map((instrument) => [instrument.id, instrument]));

  const decisions = allocations.map((allocation) => {
    const series = returnsByInstrument.get(allocation.instrumentId) ?? [];
    const vol = Math.sqrt(Math.max(variance(series), 1e-6));
    const riskParityWeight = 1 / vol;
    const maxWeight = Number(allocation.maxWeight);
    const minWeight = Number(allocation.minWeight);
    const volTargetWeight = targetVol / Math.max(vol, 1e-6);
    const preClamped = Math.min(maxWeight, Math.max(minWeight, riskParityWeight * volTargetWeight));
    return {
      allocation,
      instrument: instrumentById.get(allocation.instrumentId),
      vol,
      targetWeight: preClamped,
    };
  }).filter((decision) => decision.instrument);

  const grossSum = decisions.reduce((sum, decision) => sum + decision.targetWeight, 0);
  const grossScale = grossSum > baseGrossLimit ? baseGrossLimit / grossSum : 1;
  const scaledDecisions = decisions.map((decision) => ({
    ...decision,
    targetWeight: decision.targetWeight * grossScale,
  }));

  const executionPlan = scaledDecisions.map((decision) => {
    const liquidity = Math.min(1, Math.max(0.1, 1 / Math.max(decision.vol * 100, 1)));
    const twapLite = decision.targetWeight > 0.2 || liquidity < 0.35;
    const slices = twapLite ? Math.min(8, Math.max(2, Math.ceil(decision.targetWeight / 0.05))) : 1;
    const symbol = decision.instrument?.symbol ?? '';
    return {
      instrumentId: decision.allocation.instrumentId,
      symbol,
      side: decision.targetWeight >= 0 ? 'buy' : 'sell',
      targetWeight: Math.abs(decision.targetWeight),
      slicing: twapLite ? 'twap_lite' : 'single',
      slices,
      expectedSlippageBps: twapLite ? 14 : 6,
      expectedImpactBps: Math.max(1, Math.round((Math.abs(decision.targetWeight) / liquidity) * 10)),
    };
  });

  await db.insert(schema.tradingPortfolioRebalances).values({
    tenantId: payload.tenantId,
    portfolioId: payload.portfolioId,
    asofTimestamp: new Date(payload.asofTimestamp),
    inputs: {
      ...payload.inputs,
      covarianceMatrix,
      returnsByInstrument: Object.fromEntries(Array.from(returnsByInstrument.entries())),
    },
    decisions: {
      ...payload.decisions,
      allocationMode: 'risk_parity_with_vol_target',
      decisions: scaledDecisions.map((decision) => ({
        instrumentId: decision.allocation.instrumentId,
        symbol: decision.instrument?.symbol ?? '',
        targetWeight: decision.targetWeight,
        volatility: decision.vol,
      })),
      executionPlan,
    },
    status: 'succeeded',
  });

  for (const plan of executionPlan) {
    await db.insert(schema.tradingExecutionReports).values({
      tenantId: payload.tenantId,
      portfolioId: payload.portfolioId,
      instrumentId: plan.instrumentId,
      marketType: allocations.find((allocation) => allocation.instrumentId === plan.instrumentId)?.marketType ?? 'futures',
      orderPayload: {
        symbol: plan.symbol,
        side: plan.side,
        slicing: plan.slicing,
        slices: plan.slices,
      },
      executionResult: {
        expectedStatus: 'planned',
        reason: 'portfolio_rebalance_worker',
      },
      estimatedCosts: {
        expectedSlippageBps: plan.expectedSlippageBps,
        expectedImpactBps: plan.expectedImpactBps,
      },
    });
  }
}
