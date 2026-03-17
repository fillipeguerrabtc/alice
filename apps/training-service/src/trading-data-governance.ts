import { and, eq, inArray, or, sql, type SQL, schema } from '@alice/database';
import {
  TRADING_TRAINING_DOMAIN,
  TRADING_TRAINING_EXTERNAL_SOURCE_TYPE,
  TRADING_TRAINING_SOURCE_TYPES,
} from '@alice/shared';

export const TRADING_DATA_SOURCE_TYPES = TRADING_TRAINING_SOURCE_TYPES;

type TradingTrainingRow = {
  sourceType?: string | null;
  namespaceId?: string | null;
  inferredNamespaceId?: string | null;
  inferredDomain?: string | null;
};

export function isTradingTrainingRow(row: TradingTrainingRow, namespaceId?: string | null): boolean {
  const sourceType = row.sourceType ?? null;
  if (TRADING_DATA_SOURCE_TYPES.includes(sourceType as (typeof TRADING_DATA_SOURCE_TYPES)[number])) {
    return true;
  }

  if (sourceType !== TRADING_TRAINING_EXTERNAL_SOURCE_TYPE) {
    return false;
  }

  if (row.inferredDomain === TRADING_TRAINING_DOMAIN) {
    return true;
  }

  if (!namespaceId) {
    return false;
  }

  return row.namespaceId === namespaceId || row.inferredNamespaceId === namespaceId;
}

export function buildTradingTrainingSourceCondition(namespaceId?: string | null): SQL<unknown> {
  const externalCondition = namespaceId
    ? and(
        eq(schema.trainingData.sourceType, TRADING_TRAINING_EXTERNAL_SOURCE_TYPE),
        or(
          eq(schema.trainingData.namespaceId, namespaceId),
          eq(schema.trainingData.inferredNamespaceId, namespaceId),
          eq(schema.trainingData.inferredDomain, TRADING_TRAINING_DOMAIN),
        ),
      )
    : and(
        eq(schema.trainingData.sourceType, TRADING_TRAINING_EXTERNAL_SOURCE_TYPE),
        eq(schema.trainingData.inferredDomain, TRADING_TRAINING_DOMAIN),
      );

  return or(
    inArray(schema.trainingData.sourceType, [...TRADING_DATA_SOURCE_TYPES]),
    externalCondition,
  ) as SQL<unknown>;
}

export type TradingDataGovernancePolicy = {
  requireStrictApprovedDataForAutoEngine: boolean;
  enforceMinInferenceConfidence: boolean;
  minInferenceConfidence: number;
};

function parseEnvBoolean(rawValue: string | undefined, defaultValue: boolean): boolean {
  if (typeof rawValue === 'undefined') return defaultValue;
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return defaultValue;
}

function parseEnvConfidence(rawValue: string | undefined, defaultValue: number): number {
  const raw = rawValue?.trim();
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return defaultValue;
  }
  return parsed;
}

export function loadTradingDataGovernancePolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env
): TradingDataGovernancePolicy {
  return {
    requireStrictApprovedDataForAutoEngine: parseEnvBoolean(
      env.TRAINING_TRADING_REQUIRE_STRICT_APPROVED_DATA,
      true
    ),
    enforceMinInferenceConfidence: parseEnvBoolean(
      env.TRAINING_TRADING_ENFORCE_MIN_INFERENCE_CONFIDENCE,
      true
    ),
    minInferenceConfidence: parseEnvConfidence(
      env.TRAINING_TRADING_MIN_INFERENCE_CONFIDENCE,
      0.65
    ),
  };
}

export function buildTradingDataEligibilityConditions(params: {
  tenantId: string;
  namespaceId: string;
  policy: TradingDataGovernancePolicy;
}): SQL[] {
  const conditions: SQL[] = [
    eq(schema.trainingData.tenantId, params.tenantId),
    eq(schema.trainingData.status, 'approved'),
    eq(schema.trainingData.needsHumanReview, false),
    eq(schema.trainingData.isDuplicate, false),
    buildTradingTrainingSourceCondition(params.namespaceId),
  ];

  if (params.policy.enforceMinInferenceConfidence) {
    conditions.push(
      sql`COALESCE(${schema.trainingData.inferenceConfidence}, 0) >= ${params.policy.minInferenceConfidence}`
    );
  }

  return conditions;
}
