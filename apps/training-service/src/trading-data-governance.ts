import { eq, inArray, sql, type SQL, schema } from '@alice/database';

export const TRADING_DATA_SOURCE_TYPES = [
  'trading_signal',
  'trading_order',
  'trading_demo',
  'trading_postmortem',
] as const;

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
    eq(schema.trainingData.namespaceId, params.namespaceId),
    eq(schema.trainingData.status, 'approved'),
    eq(schema.trainingData.needsHumanReview, false),
    eq(schema.trainingData.isDuplicate, false),
    inArray(schema.trainingData.sourceType, [...TRADING_DATA_SOURCE_TYPES]),
  ];

  if (params.policy.enforceMinInferenceConfidence) {
    conditions.push(
      sql`COALESCE(${schema.trainingData.inferenceConfidence}, 0) >= ${params.policy.minInferenceConfidence}`
    );
  }

  return conditions;
}
