import { and, eq, getDatabase, schema } from '@alice/database';
import type { TradingOrderMetadata, TradingSignalMetadata } from '@alice/shared';
import type { TradingMarketType } from './tradingTypes.js';
import { z } from 'zod';

export type TradingSignalDatasetCreationResult = {
  dataset: schema.TrainingData;
  created: boolean;
  status: schema.TrainingData['status'];
  qualityScore: number;
  duplicate: {
    isDuplicate: boolean;
    duplicateOfId?: string;
    similarityScore?: number;
  };
};

export function createTradingDatasetOrchestrationService(deps: {
  tradingDatasetMinQuality: number;
  computeSemHash: (value: string) => string;
  buildTradingDatasetSeedFromSignal: (params: {
    authContext: { tenantId: string; userId: string };
    signal: schema.TradingSignal;
  }) => Promise<{
    marketContext: schema.TradingDataset['marketContext'];
    prompt: string;
    responsePayload: Record<string, unknown>;
    interval: string;
  }>;
  buildMarketContextFromSignal: (params: {
    auth: { tenantId: string; userId: string };
    symbol: string;
    interval: string;
    marketType: TradingMarketType;
    marginMode?: undefined;
    analysis?: undefined;
  }) => Promise<schema.TradingDataset['marketContext']>;
  generateTradingDatasetEmbedding: (text: string) => Promise<number[]>;
  detectTradingDatasetDuplicate: (params: {
    tenantId: string;
    semhash: string;
    embedding: number[];
  }) => Promise<{ isDuplicate: boolean; duplicateOfId?: string; similarityScore?: number }>;
  computeTradingDatasetQualityScore: (params: {
    confidence?: number | null;
    prompt: string;
    response: string;
  }) => number;
  resolveActionTypeFromOrder: (order: schema.TradingOrder, signal?: schema.TradingSignal) => string;
  buildOrderExecutionPrompt: (params: {
    marketContext: schema.TradingDataset['marketContext'];
    order: schema.TradingOrder;
    signal?: schema.TradingSignal;
  }) => string;
  resolveDatasetNamespace: (params: {
    tenantId: string;
    preferredNamespaceIds: Array<string | null | undefined>;
  }) => Promise<{ namespaceId: string | null; inferenceConfidence: number | null }>;
  recordDatasetMetrics: (params: {
    sourceType: 'signal' | 'order';
    status: 'pending' | 'rejected';
    qualityScore: number;
    isDuplicate: boolean;
    autoRejectedByQuality: boolean;
  }) => void;
}) {
  async function createTradingDatasetFromSignalSource(params: {
    authContext: { tenantId: string; userId: string };
    signal: schema.TradingSignal;
    reviewNotes?: string;
    namespaceId?: string;
  }): Promise<TradingSignalDatasetCreationResult> {
    const db = getDatabase();

    const existing = await db.query.trainingData.findFirst({
      where: and(
        eq(schema.trainingData.tenantId, params.authContext.tenantId),
        eq(schema.trainingData.sourceType, 'trading_signal'),
        eq(schema.trainingData.sourceId, params.signal.id),
      ),
    });

    if (existing) {
      return {
        dataset: existing,
        created: false,
        status: existing.status,
        qualityScore: existing.qualityScore ?? 0,
        duplicate: {
          isDuplicate: existing.isDuplicate ?? false,
          duplicateOfId: existing.duplicateOfId ?? undefined,
          similarityScore: existing.similarityScore ?? undefined,
        },
      };
    }

    const seed = await deps.buildTradingDatasetSeedFromSignal({
      authContext: params.authContext,
      signal: params.signal,
    });

    const responsePayload = seed.responsePayload;
    const prompt = seed.prompt;
    const responseText = JSON.stringify(responsePayload);
    const semhash = deps.computeSemHash(`${prompt}\n${responseText}`);
    const embedding = await deps.generateTradingDatasetEmbedding(`${prompt}\n${responseText}`);
    const duplicateResult = await deps.detectTradingDatasetDuplicate({
      tenantId: params.authContext.tenantId,
      semhash,
      embedding,
    });
    const qualityScore = deps.computeTradingDatasetQualityScore({
      confidence: params.signal.confidence ?? undefined,
      prompt,
      response: responseText,
    });
    const autoRejectedByQuality = qualityScore < deps.tradingDatasetMinQuality;
    const status: 'pending' | 'rejected' = duplicateResult.isDuplicate || autoRejectedByQuality ? 'rejected' : 'pending';
    const reviewNotes = autoRejectedByQuality
      ? `Auto-rejeitado: qualidade ${qualityScore.toFixed(2)} abaixo do mínimo (${deps.tradingDatasetMinQuality}).`
      : params.reviewNotes ?? null;
    const signalMetadata = (params.signal.metadata ?? {}) as TradingSignalMetadata;
    const metadataNamespaceId = z.string().uuid().safeParse(signalMetadata.namespaceId).success
      ? signalMetadata.namespaceId
      : null;
    const explicitNamespaceId = params.namespaceId ?? null;
    const { namespaceId, inferenceConfidence } = await deps.resolveDatasetNamespace({
      tenantId: params.authContext.tenantId,
      preferredNamespaceIds: [explicitNamespaceId, metadataNamespaceId],
    });
    const metadataAgentId = z.string().uuid().safeParse(signalMetadata.agentId).success
      ? signalMetadata.agentId
      : null;

    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
      { role: 'user', content: prompt },
      { role: 'assistant', content: responseText },
    ];

    const [created] = await db.insert(schema.trainingData).values({
      tenantId: params.authContext.tenantId,
      namespaceId,
      source: 'trading',
      sourceType: 'trading_signal',
      sourceId: params.signal.id,
      sourceMetadata: {
        interval: seed.interval,
        marketType: params.signal.marketType,
        namespaceId: metadataNamespaceId,
        agentId: metadataAgentId,
        instrumentId: (params.signal as Record<string, unknown>).instrumentId ?? null,
        venue: (seed.marketContext as Record<string, unknown>).venue ?? null,
        assetClass: (seed.marketContext as Record<string, unknown>).assetClass ?? 'crypto',
        timeframe: seed.interval,
        actionType: params.signal.signalType,
        marketContext: seed.marketContext,
        signalId: params.signal.id,
        orderId: params.signal.executedOrderId ?? null,
        outcome: (params.signal as Record<string, unknown>).outcome ?? null,
      } as Record<string, unknown>,
      messages,
      qualityScore,
      status: namespaceId ? status : 'pending',
      needsHumanReview: namespaceId ? false : true,
      quarantineReason: namespaceId ? null : 'namespace_unresolved',
      inferenceConfidence,
      reviewNotes,
      semhash,
      embedding,
      isDuplicate: duplicateResult.isDuplicate,
      duplicateOfId: duplicateResult.duplicateOfId ?? null,
      similarityScore: duplicateResult.similarityScore ?? null,
    }).returning();

    if (created) {
      await db.insert(schema.trainingLineageEvents).values({
        tenantId: params.authContext.tenantId,
        namespaceId: created.namespaceId ?? null,
        eventType: 'training_data_created',
        sourceTable: 'trading_signals',
        sourceId: params.signal.id,
        producedTable: 'training_data',
        producedId: created.id,
        metadata: {
          sourceType: 'trading_signal',
        },
      });
      await db
        .update(schema.tradingSignals)
        .set({ sentToTrainingAt: new Date() })
        .where(eq(schema.tradingSignals.id, params.signal.id));
    }

    deps.recordDatasetMetrics({
      sourceType: 'signal',
      status,
      qualityScore,
      isDuplicate: duplicateResult.isDuplicate,
      autoRejectedByQuality,
    });

    return {
      dataset: created,
      created: true,
      status,
      qualityScore,
      duplicate: {
        isDuplicate: duplicateResult.isDuplicate,
        duplicateOfId: duplicateResult.duplicateOfId ?? undefined,
        similarityScore: duplicateResult.similarityScore ?? undefined,
      },
    };
  }

  async function createTradingDatasetFromOrder(params: {
    authContext: { tenantId: string; userId: string };
    order: schema.TradingOrder;
  }): Promise<{ created?: schema.TrainingData; skipped?: string }> {
    const db = getDatabase();

    const existing = await db.query.trainingData.findFirst({
      where: and(
        eq(schema.trainingData.tenantId, params.authContext.tenantId),
        eq(schema.trainingData.sourceType, 'trading_order'),
        eq(schema.trainingData.sourceId, params.order.id),
      ),
    });
    if (existing) {
      return { skipped: 'training data já existe para a ordem' };
    }

    const signalId = params.order.signalId ?? (params.order.metadata as TradingOrderMetadata | undefined)?.signalId;
    const signal = signalId
      ? await db.query.tradingSignals.findFirst({
        where: and(
          eq(schema.tradingSignals.id, signalId),
          eq(schema.tradingSignals.tenantId, params.authContext.tenantId),
        ),
      })
      : null;

    const marketContext = await deps.buildMarketContextFromSignal({
      auth: params.authContext,
      symbol: params.order.symbol,
      interval: '5m',
      marketType: params.order.marketType as TradingMarketType,
      marginMode: undefined,
      analysis: undefined,
    });

    const prompt = deps.buildOrderExecutionPrompt({ marketContext, order: params.order, signal: signal ?? undefined });
    const actionType = deps.resolveActionTypeFromOrder(params.order, signal ?? undefined);
    const responsePayload = {
      actionType,
      executedPrice: params.order.avgFilledPrice ?? params.order.price ?? null,
      executedSize: params.order.filledSize ?? params.order.size,
      leverage: params.order.leverage ?? null,
      stopLoss: (params.order.metadata as TradingOrderMetadata | undefined)?.stopLoss ?? null,
      takeProfit: (params.order.metadata as TradingOrderMetadata | undefined)?.takeProfit ?? null,
      signalId: signal?.id ?? null,
    };

    const responseText = JSON.stringify(responsePayload);
    const semhash = deps.computeSemHash(`${prompt}\n${responseText}`);
    const embedding = await deps.generateTradingDatasetEmbedding(`${prompt}\n${responseText}`);
    const duplicateResult = await deps.detectTradingDatasetDuplicate({
      tenantId: params.authContext.tenantId,
      semhash,
      embedding,
    });
    const qualityScore = deps.computeTradingDatasetQualityScore({
      confidence: signal?.confidence ?? undefined,
      prompt,
      response: responseText,
    });
    const autoRejectedByQuality = qualityScore < deps.tradingDatasetMinQuality;
    const status: 'pending' | 'rejected' = duplicateResult.isDuplicate || autoRejectedByQuality ? 'rejected' : 'pending';
    const reviewNotes = autoRejectedByQuality
      ? `Auto-rejeitado: qualidade ${qualityScore.toFixed(2)} abaixo do mínimo (${deps.tradingDatasetMinQuality}).`
      : null;

    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
      { role: 'user', content: prompt },
      { role: 'assistant', content: responseText },
    ];

    const orderMetadata = (params.order.metadata ?? {}) as Record<string, unknown>;
    const metadataNamespaceId = z.string().uuid().safeParse(orderMetadata.namespaceId).success
      ? String(orderMetadata.namespaceId)
      : null;
    const signalMetadata = (signal?.metadata ?? {}) as Record<string, unknown>;
    const signalNamespaceId = z.string().uuid().safeParse(signalMetadata.namespaceId).success
      ? String(signalMetadata.namespaceId)
      : null;
    const { namespaceId, inferenceConfidence } = await deps.resolveDatasetNamespace({
      tenantId: params.authContext.tenantId,
      preferredNamespaceIds: [metadataNamespaceId, signalNamespaceId],
    });

    const [created] = await db.insert(schema.trainingData).values({
      tenantId: params.authContext.tenantId,
      namespaceId,
      source: 'trading',
      sourceType: 'trading_order',
      sourceId: params.order.id,
      sourceMetadata: {
        orderId: params.order.id,
        signalId: signal?.id ?? null,
        actionType,
        instrumentId: (params.order as Record<string, unknown>).instrumentId ?? null,
        venue: orderMetadata.venue ?? (marketContext as Record<string, unknown>).venue ?? null,
        assetClass: orderMetadata.assetClass ?? (marketContext as Record<string, unknown>).assetClass ?? 'crypto',
        timeframe: orderMetadata.timeframe ?? '5m',
        marketContext,
        outcome: orderMetadata.outcome ?? null,
      } as Record<string, unknown>,
      messages,
      qualityScore,
      status: namespaceId ? status : 'pending',
      needsHumanReview: namespaceId ? false : true,
      quarantineReason: namespaceId ? null : 'namespace_unresolved',
      inferenceConfidence,
      reviewNotes,
      semhash,
      embedding,
      isDuplicate: duplicateResult.isDuplicate,
      duplicateOfId: duplicateResult.duplicateOfId ?? null,
      similarityScore: duplicateResult.similarityScore ?? null,
    }).returning();

    if (created) {
      await db.insert(schema.trainingLineageEvents).values({
        tenantId: params.authContext.tenantId,
        namespaceId: created.namespaceId ?? null,
        eventType: 'training_data_created',
        sourceTable: 'trading_orders',
        sourceId: params.order.id,
        producedTable: 'training_data',
        producedId: created.id,
        metadata: {
          sourceType: 'trading_order',
        },
      });
    }

    deps.recordDatasetMetrics({
      sourceType: 'order',
      status,
      qualityScore,
      isDuplicate: duplicateResult.isDuplicate,
      autoRejectedByQuality,
    });

    return { created };
  }

  return {
    createTradingDatasetFromSignalSource,
    createTradingDatasetFromOrder,
  };
}
