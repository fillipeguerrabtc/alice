/**
 * Gerador de Datasets de Treinamento a partir de Post-Mortems
 *
 * Cria pares prompt/response no schema exato para fine-tuning do Qwen2.5,
 * populando a tabela trading_dataset com status 'pending' para aprovação manual.
 *
 * Fluxo: PostMortem (completed) → Dataset (pending) → Aprovação → Training
 *
 * Arquitetura:
 * - Dados de posição extraídos do classification JSONB (positionData)
 * - Contexto de mercado do evidence pack snapshot (data.ticker, data.candles)
 * - Anotações compostas de classification + motivators + successFactors + failureFactors + lessons
 *
 * @author Fillipe Guerra
 * @since 09/02/2026
 */

import { eq, and } from 'drizzle-orm';
import { getDatabase, schema } from '@alice/database';
import type { InferSelectModel } from 'drizzle-orm';
import { createLogger } from '@alice/logger';

const logger = createLogger('dataset-generator');

// Tipos inferidos do schema Drizzle
type TradingPostmortem = InferSelectModel<typeof schema.tradingPostmortems>;
type TradingSnapshot = InferSelectModel<typeof schema.tradingSnapshots>;

// ============================================================================
// Tipos internos
// ============================================================================

/** Dados de posição armazenados no classification JSONB */
interface ClassificationPositionData {
  symbol: string;
  marketType: string;
  side: string;
  leverage: number;
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number;
  totalFees: number;
  openedAt: string;
  closedAt: string;
  entrySnapshotId?: string;
  exitSnapshotId?: string;
}

/** Estrutura do classification JSONB */
interface ClassificationData {
  tradeStyle: string;
  archetype: string;
  strategy: string;
  techniqueScores: Array<{
    key: string;
    confidence: number;
    rationale: string;
    evidence?: Record<string, unknown>;
  }>;
  durationSec: number;
  pnlPct: number;
  positionData: ClassificationPositionData;
}

interface DatasetMarketContext {
  symbol: string;
  marketType: string;
  snapshots: {
    entry?: string;
    exit?: string;
  };
  regime: {
    trend: string;
    volatility: string;
    liquidity: string;
  };
  timestamp: string;
  price: number;
  change24h: number;
  volume24h: number;
  fundingRate: number;
  openInterest: number;
  recentCandles: unknown[];
  indicators?: Record<string, number>;
}

interface DatasetTradeExecution {
  position: {
    side: string;
    leverage: number;
    entryPrice: number;
    exitPrice: number;
    durationSec: number;
    pnl: number;
    pnlPct: number;
  };
  executionModel: {
    slippageBps: number;
    feeBps: number;
  };
}

interface DatasetAutoAnnotation {
  classification: {
    tradeStyle: string;
    archetype: string;
    strategy: string;
    techniqueScores: Array<{
      key: string;
      score: number;
      evidence: Record<string, unknown>;
    }>;
  };
  motivators: Array<{
    title: string;
    explanation: string;
    citedValues: Record<string, unknown>;
  }>;
  successFactors: string[];
  failureFactors: string[];
  lessons: {
    repeat: string[];
    avoid: string[];
  };
}

// ============================================================================
// Funções auxiliares
// ============================================================================

/**
 * Extrai classificação tipada do JSONB do post-mortem
 */
function extractClassification(postmortem: TradingPostmortem): ClassificationData | null {
  const raw = postmortem.classification as Record<string, unknown> | null;
  if (!raw || !raw.positionData) {
    return null;
  }
  return raw as unknown as ClassificationData;
}

/**
 * Infere regime de mercado a partir do snapshot de entrada
 */
function inferRegime(snapshot: TradingSnapshot | null): DatasetMarketContext['regime'] {
  if (!snapshot?.data) {
    return { trend: 'unknown', volatility: 'medium', liquidity: 'unknown' };
  }

  const data = snapshot.data as Record<string, unknown>;
  const ticker = data.ticker as Record<string, unknown> | undefined;

  // Regime básico baseado em dados disponíveis
  const change24h = Number(ticker?.changeRate ?? 0) * 100;
  const volume = Number(ticker?.vol ?? 0);

  let trend = 'sideways';
  if (change24h > 2) trend = 'up';
  else if (change24h < -2) trend = 'down';

  let volatility = 'medium';
  if (Math.abs(change24h) > 5) volatility = 'high';
  else if (Math.abs(change24h) < 1) volatility = 'low';

  const liquidity = volume > 0 ? 'good' : 'unknown';

  return { trend, volatility, liquidity };
}

/**
 * Calcula quality score baseado na completude do post-mortem
 */
function calculateQualityScore(
  postmortem: TradingPostmortem,
  hasEntrySnapshot: boolean,
  hasExitSnapshot: boolean,
): number {
  let score = 0;
  const weights = {
    hasPhase1: 0.2,
    hasPhase2: 0.2,
    hasEntrySnapshot: 0.15,
    hasExitSnapshot: 0.15,
    hasMotivators: 0.1,
    hasTechniqueScores: 0.1,
    hasEngineVersions: 0.1,
  };

  if (postmortem.status === 'completed' || postmortem.status === 'completed_cpu') {
    score += weights.hasPhase1;
  }
  if (postmortem.status === 'completed') {
    score += weights.hasPhase2;
  }
  if (hasEntrySnapshot) score += weights.hasEntrySnapshot;
  if (hasExitSnapshot) score += weights.hasExitSnapshot;

  const motivators = postmortem.motivators as unknown[] | null;
  if (motivators && motivators.length > 0) {
    score += weights.hasMotivators;
  }

  const classification = extractClassification(postmortem);
  if (classification?.techniqueScores && classification.techniqueScores.length > 0) {
    score += weights.hasTechniqueScores;
  }
  if (postmortem.engineVersions) {
    score += weights.hasEngineVersions;
  }

  return Math.round(score * 100) / 100;
}

// ============================================================================
// Geração de prompt/response
// ============================================================================

/**
 * Gera o prompt do sistema para o dataset
 */
function generateSystemPrompt(): string {
  return 'Você é um Agente de Trading especializado em criptomoedas. Analise o contexto de mercado, ' +
    'execução do trade e anotações automáticas para fornecer insights precisos sobre decisões de ' +
    'entrada, sizing, gestão de risco e invalidação.';
}

/**
 * Gera o prompt do usuário com contexto completo
 */
function generateUserPrompt(
  marketContext: DatasetMarketContext,
  tradeExecution: DatasetTradeExecution,
  autoAnnotation: DatasetAutoAnnotation,
): string {
  const contextJson = JSON.stringify({
    marketContext: {
      symbol: marketContext.symbol,
      marketType: marketContext.marketType,
      regime: marketContext.regime,
      timestamp: marketContext.timestamp,
    },
    tradeExecution: {
      side: tradeExecution.position.side,
      leverage: tradeExecution.position.leverage,
      entryPrice: tradeExecution.position.entryPrice,
      exitPrice: tradeExecution.position.exitPrice,
      pnl: tradeExecution.position.pnl,
      pnlPct: tradeExecution.position.pnlPct,
      durationSec: tradeExecution.position.durationSec,
    },
    autoAnnotation: {
      tradeStyle: autoAnnotation.classification.tradeStyle,
      archetype: autoAnnotation.classification.archetype,
      techniqueScores: autoAnnotation.classification.techniqueScores.slice(0, 3),
      motivators: autoAnnotation.motivators,
    },
  }, null, 2);

  return `Dado o contexto abaixo, qual seria a melhor decisão de entrada, sizing e invalidação?\n\n${contextJson}`;
}

/**
 * Gera a resposta esperada (ideal) baseada no resultado real do trade
 */
function generateExpectedResponse(
  tradeExecution: DatasetTradeExecution,
  autoAnnotation: DatasetAutoAnnotation,
): string {
  const pnl = tradeExecution.position.pnl;
  const isProfit = pnl > 0;
  const side = tradeExecution.position.side;

  const action = side === 'long' ? 'buy' : 'sell';
  const confidence = isProfit ? Math.min(0.85, 0.6 + (tradeExecution.position.pnlPct / 100)) : 0.4;

  // Construir resposta no schema esperado
  const response = {
    action,
    confidence: Math.round(confidence * 100) / 100,
    entry: {
      type: 'market' as const,
      price: tradeExecution.position.entryPrice,
    },
    risk: {
      stopLoss: tradeExecution.position.entryPrice * (side === 'long' ? 0.98 : 1.02),
      takeProfit: tradeExecution.position.exitPrice,
      reasoning: isProfit
        ? `Trade lucrativo (${tradeExecution.position.pnlPct.toFixed(2)}%). ${autoAnnotation.motivators[0]?.title ?? 'Entrada alinhada à tendência.'}`
        : `Trade com prejuízo (${tradeExecution.position.pnlPct.toFixed(2)}%). ${autoAnnotation.lessons.avoid[0] ?? 'Reavaliar condições de entrada.'}`,
    },
    invalidations: autoAnnotation.lessons.avoid.length > 0
      ? autoAnnotation.lessons.avoid
      : ['Divergência de volume', 'Mudança de regime de mercado'],
  };

  return JSON.stringify(response, null, 2);
}

// ============================================================================
// Função principal de criação de dataset
// ============================================================================

/**
 * Cria um dataset de treinamento a partir de um post-mortem completo.
 *
 * Pré-requisitos:
 * - postmortem.status === 'completed'
 * - classification.positionData presente
 * - engineVersions presentes
 *
 * @returns ID do dataset criado ou null se não for possível criar
 */
export async function createDatasetFromPostMortem(
  postmortemId: string,
  tenantId: string,
): Promise<string | null> {
  const db = getDatabase();

  // Buscar post-mortem completo
  const postmortem = await db
    .select()
    .from(schema.tradingPostmortems)
    .where(and(
      eq(schema.tradingPostmortems.id, postmortemId),
      eq(schema.tradingPostmortems.tenantId, tenantId),
    ))
    .then((rows) => rows[0] ?? null);

  if (!postmortem) {
    logger.warn({ postmortemId, tenantId }, 'Post-mortem não encontrado');
    return null;
  }

  if (postmortem.status !== 'completed') {
    logger.warn(
      { postmortemId, status: postmortem.status },
      'Post-mortem não está completo (Phase 2 pendente) — dataset não criado'
    );
    return null;
  }

  // Extrair classificação e dados da posição do JSONB
  const classification = extractClassification(postmortem);
  if (!classification?.positionData) {
    logger.warn(
      { postmortemId },
      'Post-mortem sem positionData no classification — dataset não criado'
    );
    return null;
  }

  const posData = classification.positionData;

  // Verificar se já existe dataset para este post-mortem (idempotência)
  const existing = await db
    .select({ id: schema.tradingDataset.id })
    .from(schema.tradingDataset)
    .where(and(
      eq(schema.tradingDataset.sourceType, 'postmortem'),
      eq(schema.tradingDataset.sourceId, postmortemId),
      eq(schema.tradingDataset.tenantId, tenantId),
    ))
    .then((rows) => rows[0] ?? null);

  if (existing) {
    logger.info({ postmortemId, datasetId: existing.id }, 'Dataset já existe para este post-mortem');
    return existing.id;
  }

  // Buscar snapshots via evidence pack
  let entrySnapshot: TradingSnapshot | null = null;
  let exitSnapshot: TradingSnapshot | null = null;

  // Entry/exit snapshot IDs vêm do positionData no classification
  if (posData.entrySnapshotId) {
    entrySnapshot = await db
      .select()
      .from(schema.tradingSnapshots)
      .where(eq(schema.tradingSnapshots.id, posData.entrySnapshotId))
      .then((rows) => rows[0] ?? null);
  }

  if (posData.exitSnapshotId) {
    exitSnapshot = await db
      .select()
      .from(schema.tradingSnapshots)
      .where(eq(schema.tradingSnapshots.id, posData.exitSnapshotId))
      .then((rows) => rows[0] ?? null);
  }

  // Montar contexto de mercado
  const regime = inferRegime(entrySnapshot);
  const entryData = (entrySnapshot?.data ?? {}) as Record<string, unknown>;
  const ticker = (entryData.ticker ?? {}) as Record<string, unknown>;

  const marketContext: DatasetMarketContext = {
    symbol: posData.symbol,
    marketType: posData.marketType ?? 'futures',
    snapshots: {
      entry: posData.entrySnapshotId ?? undefined,
      exit: posData.exitSnapshotId ?? undefined,
    },
    regime,
    timestamp: posData.openedAt ?? new Date().toISOString(),
    price: posData.entryPrice ?? 0,
    change24h: Number(ticker.changeRate ?? 0) * 100,
    volume24h: Number(ticker.vol ?? 0),
    fundingRate: Number(ticker.fundingFeeRate ?? 0),
    openInterest: Number(ticker.openInterest ?? 0),
    recentCandles: Array.isArray(entryData.candles) ? entryData.candles as unknown[] : [],
    indicators: entryData.indicators as Record<string, number> | undefined,
  };

  // Montar execução do trade
  const tradeExecution: DatasetTradeExecution = {
    position: {
      side: posData.side ?? 'long',
      leverage: posData.leverage ?? 1,
      entryPrice: posData.entryPrice ?? 0,
      exitPrice: posData.exitPrice ?? 0,
      durationSec: classification.durationSec ?? 0,
      pnl: posData.pnl ?? 0,
      pnlPct: classification.pnlPct ?? 0,
    },
    executionModel: {
      slippageBps: postmortem.isDemo ? 5 : 3,
      feeBps: postmortem.isDemo ? 4 : 4,
    },
  };

  // Montar auto-anotação a partir das colunas separadas do postmortem
  const motivatorsRaw = (postmortem.motivators ?? []) as Array<Record<string, unknown>>;
  const successFactorsRaw = (postmortem.successFactors ?? []) as string[];
  const failureFactorsRaw = (postmortem.failureFactors ?? []) as string[];
  const lessonsRaw = (postmortem.lessons ?? {}) as Record<string, unknown>;

  const autoAnnotation: DatasetAutoAnnotation = {
    classification: {
      tradeStyle: classification.tradeStyle ?? 'unknown',
      archetype: classification.archetype ?? 'unknown',
      strategy: classification.strategy ?? 'unknown',
      techniqueScores: (classification.techniqueScores ?? []).map((ts) => ({
        key: ts.key,
        score: ts.confidence ?? 0,
        evidence: ts.evidence ?? {},
      })),
    },
    motivators: motivatorsRaw.map((m) => ({
      title: String(m.title ?? ''),
      explanation: String(m.explanation ?? ''),
      citedValues: (m.citedValues ?? {}) as Record<string, unknown>,
    })),
    successFactors: successFactorsRaw,
    failureFactors: failureFactorsRaw,
    lessons: {
      repeat: (lessonsRaw.repeat ?? []) as string[],
      avoid: (lessonsRaw.avoid ?? []) as string[],
    },
  };

  // Gerar prompt e resposta
  const systemPrompt = generateSystemPrompt();
  const userPrompt = generateUserPrompt(marketContext, tradeExecution, autoAnnotation);
  const expectedResponse = generateExpectedResponse(tradeExecution, autoAnnotation);

  const fullPrompt = `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userPrompt}`;

  // Determinar actionType
  const side = posData.side ?? 'long';
  const actionType = side === 'long' ? 'entry_long' : 'entry_short';

  // Calcular quality score
  const qualityScore = calculateQualityScore(postmortem, !!entrySnapshot, !!exitSnapshot);

  // Montar outcome real
  const actualOutcome = {
    profitLoss: posData.pnl ?? 0,
    profitLossPercent: classification.pnlPct ?? 0,
    duration: Math.round((classification.durationSec ?? 0) / 60),
    exitReason: 'close_position',
  };

  // Criar dataset com status pending
  const datasetValues: typeof schema.tradingDataset.$inferInsert = {
    tenantId,
    marketContext: marketContext as typeof schema.tradingDataset.$inferInsert.marketContext,
    prompt: fullPrompt,
    response: expectedResponse,
    actionType,
    actualOutcome: actualOutcome as typeof schema.tradingDataset.$inferInsert.actualOutcome,
    qualityScore,
    status: 'pending',
    sourceType: 'postmortem',
    sourceId: postmortemId,
    sourceMetadata: {
      isDemo: postmortem.isDemo,
      engineVersions: postmortem.engineVersions,
      fingerprint: postmortem.fingerprint,
      symbol: posData.symbol,
      marketType: posData.marketType,
      tradeExecution,
      autoAnnotation,
    } as Record<string, unknown>,
  };
  const [dataset] = await db.insert(schema.tradingDataset).values(datasetValues).returning({ id: schema.tradingDataset.id });

  await db
    .update(schema.tradingPostmortems)
    .set({ sentToTrainingAt: new Date() })
    .where(eq(schema.tradingPostmortems.id, postmortemId));

  logger.info(
    {
      datasetId: dataset.id,
      postmortemId,
      symbol: posData.symbol,
      qualityScore,
      isDemo: postmortem.isDemo,
    },
    'Dataset de treinamento criado a partir de post-mortem'
  );

  return dataset.id;
}

/**
 * Cria datasets em batch a partir de múltiplos post-mortems.
 * Retorna mapa de postmortemId → datasetId (ou null se falhou).
 */
export async function createDatasetsFromPostMortemsBatch(
  postmortemIds: string[],
  tenantId: string,
): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {};

  for (const pmId of postmortemIds) {
    try {
      const datasetId = await createDatasetFromPostMortem(pmId, tenantId);
      results[pmId] = datasetId;
    } catch (error) {
      logger.error(
        { err: error, postmortemId: pmId },
        'Erro ao criar dataset a partir de post-mortem'
      );
      results[pmId] = null;
    }
  }

  const created = Object.values(results).filter(Boolean).length;
  const failed = postmortemIds.length - created;

  logger.info(
    { total: postmortemIds.length, created, failed },
    'Batch de criação de datasets finalizado'
  );

  return results;
}
