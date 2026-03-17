import { and, eq, inArray, or, schema, type SQL } from '@alice/database';
import {
  TRADING_TRAINING_DOMAIN,
  TRADING_TRAINING_EXTERNAL_SOURCE_TYPE,
  TRADING_TRAINING_SOURCE_TYPES,
} from '@alice/shared';

export function buildTradingTrainingSourceCondition(tradingNamespaceId?: string | null): SQL<unknown> {
  const scopedExternalCondition = tradingNamespaceId
    ? and(
        eq(schema.trainingData.sourceType, TRADING_TRAINING_EXTERNAL_SOURCE_TYPE),
        or(
          eq(schema.trainingData.namespaceId, tradingNamespaceId),
          eq(schema.trainingData.inferredNamespaceId, tradingNamespaceId),
          eq(schema.trainingData.inferredDomain, TRADING_TRAINING_DOMAIN),
        ),
      )
    : and(
        eq(schema.trainingData.sourceType, TRADING_TRAINING_EXTERNAL_SOURCE_TYPE),
        eq(schema.trainingData.inferredDomain, TRADING_TRAINING_DOMAIN),
      );

  return or(
    inArray(schema.trainingData.sourceType, [...TRADING_TRAINING_SOURCE_TYPES]),
    scopedExternalCondition,
  ) as SQL<unknown>;
}
