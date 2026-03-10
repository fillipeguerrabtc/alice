import { and, eq, getDatabase, inArray, isNull, not, schema } from '@alice/database';
import {
  cosineSimilarity,
  GpuRequestPriority,
  GpuServiceType,
  requestGpu,
} from '@alice/shared-utils';
import type { TradingOrderMetadata } from '@alice/shared';

type TradingSourceType = typeof schema.trainingData.$inferSelect.sourceType;

export type TradingDatasetDuplicateResult = {
  isDuplicate: boolean;
  duplicateOfId?: string;
  similarityScore?: number;
};

export function createTradingDatasetCoreService(deps: {
  tradingSourceTypes: readonly TradingSourceType[];
  similarityThreshold: number;
}) {
  async function generateTradingDatasetEmbedding(text: string): Promise<number[]> {
    const gpuResponse = await requestGpu({
      serviceType: GpuServiceType.EMBEDDINGS,
      endpoint: '/embed/text',
      method: 'POST',
      priority: GpuRequestPriority.MEDIUM,
      timeout: 30000,
      body: { texts: [text] },
    });

    if (!gpuResponse.success || !gpuResponse.data) {
      throw new Error(gpuResponse.error || 'Erro ao gerar embedding de trading');
    }

    const data = gpuResponse.data as { embedding?: number[]; embeddings?: number[][] };
    const embedding = data.embedding ?? data.embeddings?.[0];
    if (!embedding || embedding.length === 0) {
      throw new Error('Embedding de trading retornou vazio');
    }

    return embedding;
  }

  async function detectTradingDatasetDuplicate(params: {
    tenantId: string;
    semhash: string;
    embedding: number[];
  }): Promise<TradingDatasetDuplicateResult> {
    const db = getDatabase();
    const existingData = await db.query.trainingData.findMany({
      where: and(
        eq(schema.trainingData.tenantId, params.tenantId),
        inArray(schema.trainingData.status, ['pending', 'approved', 'used']),
        inArray(schema.trainingData.sourceType, [...deps.tradingSourceTypes]),
        not(isNull(schema.trainingData.embedding)),
      ),
    });

    let isDuplicate = false;
    let duplicateOfId: string | undefined;
    let highestSimilarity = 0;

    for (const existing of existingData) {
      if (existing.semhash === params.semhash) {
        isDuplicate = true;
        duplicateOfId = existing.id;
        highestSimilarity = 1.0;
        break;
      }
      if (existing.embedding) {
        const similarity = cosineSimilarity(params.embedding, existing.embedding);
        if (similarity > deps.similarityThreshold && similarity > highestSimilarity) {
          isDuplicate = true;
          duplicateOfId = existing.id;
          highestSimilarity = similarity;
        }
      }
    }

    return {
      isDuplicate,
      duplicateOfId,
      similarityScore: highestSimilarity > 0 ? highestSimilarity : undefined,
    };
  }

  function computeTradingDatasetQualityScore(params: {
    confidence?: number | null;
    prompt: string;
    response: string;
  }): number {
    const promptLength = params.prompt.trim().length;
    const responseLength = params.response.trim().length;
    if (promptLength < 80 || responseLength < 80) return 0.3;
    const lengthScore = Math.min(1, (promptLength + responseLength) / 1200);
    const confidenceScore = params.confidence ?? 0.6;
    return Math.min(1, 0.4 + lengthScore * 0.4 + confidenceScore * 0.2);
  }

  function resolveActionTypeFromOrder(order: schema.TradingOrder, signal?: schema.TradingSignal) {
    if (signal?.signalType) return signal.signalType;
    if ((order.metadata as TradingOrderMetadata | undefined)?.closePosition) {
      return 'exit';
    }
    return order.side === 'buy' ? 'entry_long' : 'entry_short';
  }

  function buildOrderExecutionPrompt(params: {
    marketContext: schema.TradingDataset['marketContext'];
    order: schema.TradingOrder;
    signal?: schema.TradingSignal;
  }): string {
    const price = params.order.avgFilledPrice ?? params.order.price ?? params.marketContext.price;
    const base = [
      'Contexto de mercado:',
      `- Symbol: ${params.marketContext.symbol}`,
      `- Preço: ${params.marketContext.price}`,
      `- Variação 24h: ${params.marketContext.change24h.toFixed(2)}%`,
      `- Funding: ${params.marketContext.fundingRate}`,
      `- Open Interest: ${params.marketContext.openInterest}`,
      '',
      'Ordem executada:',
      `- Lado: ${params.order.side}`,
      `- Tipo: ${params.order.orderType}`,
      `- Tamanho: ${params.order.size}`,
      `- Preço médio: ${price}`,
      `- Alavancagem: ${params.order.leverage ?? 1}x`,
    ];

    if (params.signal?.confidence !== undefined) {
      base.push(`- Confiança do sinal: ${params.signal.confidence}`);
    }

    return `${base.join('\n')}\n\nExplique a decisão e o racional do trade executado.`;
  }

  return {
    generateTradingDatasetEmbedding,
    detectTradingDatasetDuplicate,
    computeTradingDatasetQualityScore,
    resolveActionTypeFromOrder,
    buildOrderExecutionPrompt,
  };
}
