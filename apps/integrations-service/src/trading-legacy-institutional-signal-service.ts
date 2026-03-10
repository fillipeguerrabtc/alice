import crypto from 'node:crypto';
import { and, desc, eq, getDatabase, inArray, schema } from '@alice/database';
import type { createLogger } from '@alice/logger';
import type { TradingOperationIntent } from './trading/core/types.js';
import { listTenantPortfolios } from './trading/core/portfolio-api.js';
import { getConnectedExchangesCount } from './trading/core/market-adapters.js';
import { buildDecisionPacket } from './trading/core/decision-packet.js';
import { estimateCosts } from './trading/engines/cost-model.js';
import type { GuardrailThresholdBucket } from './trading/engines/intent-selection-engine.js';
import { selectAutoIntentCandidate } from './trading/engines/intent-selection-engine.js';
import { buildCompactPrompt } from './trading/llm/compact-prompt.js';
import { enforceLlmGuardrails } from './trading/llm/llm-guardrails.js';
import { saveDecisionSnapshot } from './trading/storage/snapshot-store.js';

type TradingSignalGenerationSource = 'on_demand' | 'scheduler' | 'chat' | 'auto';
type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';

type GenerateLegacySignalResult = {
  signal: schema.TradingSignal;
  validationId: string;
  validationStatus: 'pending';
};

export function createTradingLegacyInstitutionalSignalService(deps: {
  logger: Pick<ReturnType<typeof createLogger>, 'info' | 'warn'>;
  tradingMode: string;
  tradingPromptMode: 'compact' | 'verbose';
  tradingOperationIntents: readonly TradingOperationIntent[];
  setPromptTokensEstimate: (promptMode: string, estimatedTokens: number) => void;
  createSignal: (
    authContext: { tenantId: string; userId: string },
    payload: {
      signalType: 'entry_long' | 'entry_short' | 'hold';
      symbol: string;
      marketType: TradingMarketType;
      marginMode?: TradingMarginMode;
      confidence: number;
      reasoning: string;
      metadata: Record<string, unknown>;
    },
  ) => Promise<{ success: boolean; data?: schema.TradingSignal; error?: string }>;
}) {
  async function generateLegacyInstitutionalSignal(params: {
    tenantId: string;
    userId: string;
    symbol: string;
    source: TradingSignalGenerationSource;
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    legacyFlowEnabled: boolean;
  }): Promise<GenerateLegacySignalResult | null> {
    if (!params.legacyFlowEnabled) {
      return null;
    }

    const db = getDatabase();
    const marketType = params.marketType ?? 'futures';
    const recentCandidates = await db.query.tradingUniverseCandidates.findMany({
      where: and(
        eq(schema.tradingUniverseCandidates.tenantId, params.tenantId),
        eq(schema.tradingUniverseCandidates.marketType, marketType),
      ),
      orderBy: [desc(schema.tradingUniverseCandidates.createdAt)],
      limit: 50,
    });
    const instrumentIds = Array.from(new Set(recentCandidates.map((candidate) => candidate.instrumentId)));
    const instruments = instrumentIds.length > 0
      ? await db.query.tradingInstruments.findMany({
        where: inArray(schema.tradingInstruments.id, instrumentIds),
      })
      : [];
    const instrumentById = new Map(instruments.map((instrument) => [instrument.id, instrument]));

    if (deps.tradingMode === 'portfolio_auto') {
      const portfolios = await listTenantPortfolios(params.tenantId);
      const selectedPortfolio = portfolios[0];
      const portfolioAllowedIntentsRaw = (selectedPortfolio?.allowedOperationIntents ?? [])
        .map((intent) => String(intent));
      const allowedOperationIntents = (portfolioAllowedIntentsRaw.length > 0
        ? portfolioAllowedIntentsRaw.filter((intent): intent is TradingOperationIntent => deps.tradingOperationIntents.includes(intent as TradingOperationIntent))
        : [...deps.tradingOperationIntents]);
      const connectedExchangesCount = await getConnectedExchangesCount(params.tenantId);
      const crossExchangeEnabled = connectedExchangesCount >= 2;
      const latestRebalance = selectedPortfolio
        ? await db.query.tradingPortfolioRebalances.findFirst({
          where: and(
            eq(schema.tradingPortfolioRebalances.tenantId, params.tenantId),
            eq(schema.tradingPortfolioRebalances.portfolioId, selectedPortfolio.id),
          ),
          orderBy: [desc(schema.tradingPortfolioRebalances.createdAt)],
        })
        : null;
      const latestExecutionReports = selectedPortfolio
        ? await db.query.tradingExecutionReports.findMany({
          where: and(
            eq(schema.tradingExecutionReports.tenantId, params.tenantId),
            eq(schema.tradingExecutionReports.portfolioId, selectedPortfolio.id),
          ),
          orderBy: [desc(schema.tradingExecutionReports.createdAt)],
          limit: 30,
        })
        : [];
      const costsByInstrument = Object.fromEntries(
        recentCandidates.map((candidate) => [
          candidate.instrumentId,
          estimateCosts({
            feeBps: Number(process.env.TRADING_COST_BASELINE_FEE_BPS ?? 8),
            slippageBps: Number(process.env.TRADING_COST_BASELINE_SLIPPAGE_BPS ?? 12),
            spreadBps: Number(process.env.TRADING_COST_BASELINE_SPREAD_BPS ?? 5),
          }),
        ]),
      );
      const candidateInputs = recentCandidates
        .map((candidate) => {
          const instrument = instrumentById.get(candidate.instrumentId);
          if (!instrument) return null;
          return {
            instrumentId: candidate.instrumentId,
            symbol: instrument.symbol,
            marketType: candidate.marketType,
            operationIntent: candidate.operationIntent ?? 'intraday',
            side: candidate.side as 'long' | 'short' | 'neutral',
            expectedEdge: Number(candidate.expectedEdge ?? 0),
            confidenceRaw: Number(candidate.confidenceRaw ?? 0),
            confidenceCalibrated: candidate.confidenceCalibrated === null ? null : Number(candidate.confidenceCalibrated ?? 0),
            dsrScore: candidate.dsrScore === null ? null : Number(candidate.dsrScore ?? 0),
            pboScore: candidate.pboScore === null ? null : Number(candidate.pboScore ?? 1),
            riskFlags: Array.isArray(candidate.riskFlags) ? candidate.riskFlags.map(String) : [],
            timeframe: candidate.timeframe,
          };
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
      const packet = buildDecisionPacket({
        portfolioId: selectedPortfolio?.id,
        decisions: [],
        costs: costsByInstrument,
        evidence: {
          candidates: recentCandidates.length,
          rebalanceAsOf: latestRebalance?.asofTimestamp ?? null,
          executionReports: latestExecutionReports.map((report) => ({
            id: report.id,
            instrumentId: report.instrumentId,
            createdAt: report.createdAt,
            estimatedCosts: report.estimatedCosts,
          })),
        },
      });
      await saveDecisionSnapshot(params.tenantId, packet as unknown as Record<string, unknown>);
      const promptData = buildCompactPrompt(packet);
      deps.setPromptTokensEstimate(deps.tradingPromptMode, promptData.estimatedTokens);
      const guardrails = enforceLlmGuardrails({ estimatedTokens: promptData.estimatedTokens, promptMode: deps.tradingPromptMode });
      deps.logger.info({
        tradingMode: deps.tradingMode,
        promptMode: deps.tradingPromptMode,
        promptChars: promptData.chars,
        estimatedTokens: promptData.estimatedTokens,
        guardrails,
        universeScanCount: recentCandidates.length,
      }, 'Pacote institucional de portfólio gerado');

      const guardrailRows = await db.query.tradingGuardrailThresholds.findMany({
        where: and(
          eq(schema.tradingGuardrailThresholds.tenantId, params.tenantId),
          eq(schema.tradingGuardrailThresholds.marketType, marketType),
        ),
      });
      const guardrailsByIntent: Partial<Record<TradingOperationIntent, GuardrailThresholdBucket>> = {};
      for (const row of guardrailRows) {
        const intent = row.intent as TradingOperationIntent;
        guardrailsByIntent[intent] = {
          dsrMin: Number(row.dsrMin),
          pboMax: Number(row.pboMax),
        };
      }

      const intentSelection = selectAutoIntentCandidate({
        candidates: candidateInputs,
        costsByInstrument,
        allowedIntents: allowedOperationIntents,
        crossExchangeEnabled,
        guardrailsByIntent,
      });
      const firstDecision = intentSelection.candidate;
      const signalType: 'entry_long' | 'entry_short' | 'hold' = firstDecision?.side === 'long' ? 'entry_long' : firstDecision?.side === 'short' ? 'entry_short' : 'hold';
      const createResult = await deps.createSignal(
        { tenantId: params.tenantId, userId: params.userId },
        {
          signalType,
          symbol: intentSelection.candidate?.symbol ?? params.symbol,
          marketType,
          marginMode: params.marginMode,
          confidence: Number(intentSelection.candidate?.confidenceCalibrated ?? intentSelection.candidate?.confidenceRaw ?? 0.5),
          reasoning: firstDecision
            ? `Portfolio auto via snapshot do rebalance (${latestExecutionReports.length} execution reports recentes)`
            : 'No-trade: sem candidato aprovado por edge líquido',
          metadata: {
            generationSource: params.source,
            decisionPacket: packet,
            noTrade: !firstDecision,
            rebalanceId: latestRebalance?.id ?? null,
            topCandidateEdgeNet: intentSelection.edgeNet ?? null,
            selectedOperationIntent: intentSelection.selectedIntent,
            allowedOperationIntents,
            connectedExchangesCount,
            crossExchangeEnabled,
            intentSelectionStats: {
              evaluated: intentSelection.evaluated,
              rejectedByIntent: intentSelection.rejectedByIntent,
              rejectedByGuardrails: intentSelection.rejectedByGuardrails,
            },
          },
        },
      );
      if (!createResult.success || !createResult.data) {
        throw new Error(createResult.error || 'Falha ao persistir sinal institucional de portfólio');
      }
      return { signal: createResult.data, validationId: crypto.randomUUID(), validationStatus: 'pending' };
    }

    const selected = recentCandidates.find((candidate) => (instrumentById.get(candidate.instrumentId)?.symbol ?? '') === params.symbol) ?? recentCandidates[0];
    const selectedInstrument = selected ? instrumentById.get(selected.instrumentId) : null;
    const selectedSymbol = selectedInstrument?.symbol ?? params.symbol;
    const selectedBySymbol = recentCandidates.find((candidate) => (instrumentById.get(candidate.instrumentId)?.symbol ?? '') === params.symbol) ?? selected;

    if (!selectedBySymbol) {
      return null;
    }

    const edge = Number(selectedBySymbol.expectedEdge ?? 0);
    const cost = estimateCosts({
      feeBps: Number(process.env.TRADING_COST_BASELINE_FEE_BPS ?? 8),
      slippageBps: Number(process.env.TRADING_COST_BASELINE_SLIPPAGE_BPS ?? 12),
      spreadBps: Number(process.env.TRADING_COST_BASELINE_SPREAD_BPS ?? 5),
    });
    const net = edge - (cost.totalBps / 10_000);
    const approved = net > 0 && Number(selectedBySymbol.dsrScore ?? 0) >= 0 && Number(selectedBySymbol.pboScore ?? 1) <= 0.7;
    const signalType: 'entry_long' | 'entry_short' | 'hold' = approved
      ? (selectedBySymbol.side === 'short' ? 'entry_short' : selectedBySymbol.side === 'long' ? 'entry_long' : 'hold')
      : 'hold';
    const createResult = await deps.createSignal(
      { tenantId: params.tenantId, userId: params.userId },
      {
        signalType,
        symbol: selectedSymbol,
        marketType: selectedBySymbol.marketType as TradingMarketType,
        marginMode: selectedBySymbol.marginMode ?? undefined,
        confidence: Number(selectedBySymbol.confidenceCalibrated ?? selectedBySymbol.confidenceRaw ?? 0),
        reasoning: approved ? 'Candidate aprovado por guardrails institucionais' : 'No-trade: guardrails de edge/custos/DSR/PBO',
        metadata: {
          generationSource: params.source,
          candidateId: selectedBySymbol.id,
          expectedEdgeNet: net,
          dsrScore: selectedBySymbol.dsrScore,
          pboScore: selectedBySymbol.pboScore,
        },
      },
    );
    if (!createResult.success || !createResult.data) {
      throw new Error(createResult.error || 'Falha ao persistir sinal institucional');
    }
    return { signal: createResult.data, validationId: crypto.randomUUID(), validationStatus: 'pending' };
  }

  return {
    generateLegacyInstitutionalSignal,
  };
}
