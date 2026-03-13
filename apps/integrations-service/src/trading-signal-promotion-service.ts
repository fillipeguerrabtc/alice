import { and, desc, eq, inArray } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import { z } from 'zod';
import type {
  TrainingDatasetManifest,
  TradingSignalEligibilityStatus,
  TradingSignalMetadata,
  TradingSignalPromotionStage,
  TradingSignalPromotionValidationState,
} from '@alice/shared';

const promotionStageRank: Record<TradingSignalPromotionStage, number> = {
  candidate_evidence_captured: 1,
  dataset_candidate: 2,
  approved_dataset_version: 3,
  calibration_result: 4,
  demo_eligible: 5,
  real_eligible: 6,
};

const directionalSignalTypes = new Set<schema.TradingSignal['signalType']>(['entry_long', 'entry_short']);

const promotionReasonHumanMap: Record<string, string> = {
  NON_DIRECTIONAL_SIGNAL: 'Somente sinais direcionais (entry_long/entry_short) podem seguir para elegibilidade de execução.',
  VALIDATION_NOT_VALIDATED: 'Validation state precisa estar em validated para seguir com promoção de execução.',
  DATASET_CANDIDATE_MISSING: 'Sinal ainda não foi enviado para dataset curation no Training.',
  DATASET_CANDIDATE_NOT_APPROVED: 'Dataset candidate ainda não foi aprovado no fluxo de revisão do Training.',
  DATASET_VERSION_MISSING: 'Ainda não existe dataset version aprovado contendo esta evidência.',
  CALIBRATION_MISSING: 'Calibração estatística ainda não disponível para a estratégia candidata.',
  REAL_PROMOTION_REQUIRED: 'Elegibilidade real requer promoção explícita por usuário autorizado.',
};

const metadataNamespaceSchema = z.string().uuid();

function isDirectionalSignalType(signalType: schema.TradingSignal['signalType']): boolean {
  return directionalSignalTypes.has(signalType);
}

function normalizeValidationState(
  validationStatus: unknown,
): TradingSignalPromotionValidationState {
  if (validationStatus === 'validated') return 'validated';
  if (validationStatus === 'failed') return 'failed';
  return 'pending';
}

function resolveEvidenceSource(signal: schema.TradingSignal): {
  autoRunId: string | null;
  autoDecisionId: string | null;
  evidenceSourceType: string;
  evidenceSourceId: string;
} {
  const metadata = (signal.metadata ?? {}) as TradingSignalMetadata;
  const autoDecisionId = typeof metadata.autoDecisionId === 'string' ? metadata.autoDecisionId : null;
  const autoRunId = typeof metadata.autoRunId === 'string' ? metadata.autoRunId : null;

  if (autoDecisionId) {
    return {
      autoRunId,
      autoDecisionId,
      evidenceSourceType: 'auto_decision',
      evidenceSourceId: autoDecisionId,
    };
  }

  if (autoRunId) {
    return {
      autoRunId,
      autoDecisionId: null,
      evidenceSourceType: 'auto_run',
      evidenceSourceId: autoRunId,
    };
  }

  return {
    autoRunId: null,
    autoDecisionId: null,
    evidenceSourceType: 'signal',
    evidenceSourceId: signal.id,
  };
}

function getPromotionStageMax(
  current: TradingSignalPromotionStage,
  derived: TradingSignalPromotionStage,
): TradingSignalPromotionStage {
  return promotionStageRank[current] >= promotionStageRank[derived] ? current : derived;
}

function manifestContainsTrainingDataId(manifest: unknown, trainingDataId: string): boolean {
  if (!manifest || typeof manifest !== 'object') return false;
  const rows = (manifest as TrainingDatasetManifest).rows;
  if (!rows || typeof rows !== 'object') return false;

  const allRows = [
    ...(Array.isArray(rows.train) ? rows.train : []),
    ...(Array.isArray(rows.validation) ? rows.validation : []),
    ...(Array.isArray(rows.holdout) ? rows.holdout : []),
  ];

  return allRows.some((row) => row?.id === trainingDataId);
}

function resolveDemoEligibility(params: {
  signalType: schema.TradingSignal['signalType'];
  validationState: TradingSignalPromotionValidationState;
  datasetCandidateId: string | null;
  datasetCandidateStatus: schema.TrainingData['status'] | null;
  datasetVersionId: string | null;
  calibrationId: string | null;
}): { status: TradingSignalEligibilityStatus; reasonCode: string | null } {
  if (!isDirectionalSignalType(params.signalType)) {
    return { status: 'blocked', reasonCode: 'NON_DIRECTIONAL_SIGNAL' };
  }
  if (params.validationState !== 'validated') {
    return { status: 'blocked', reasonCode: 'VALIDATION_NOT_VALIDATED' };
  }
  if (!params.datasetCandidateId) {
    return { status: 'blocked', reasonCode: 'DATASET_CANDIDATE_MISSING' };
  }
  if (params.datasetCandidateStatus !== 'approved') {
    return { status: 'blocked', reasonCode: 'DATASET_CANDIDATE_NOT_APPROVED' };
  }
  if (!params.datasetVersionId) {
    return { status: 'blocked', reasonCode: 'DATASET_VERSION_MISSING' };
  }
  if (!params.calibrationId) {
    return { status: 'blocked', reasonCode: 'CALIBRATION_MISSING' };
  }
  return { status: 'eligible', reasonCode: null };
}

function resolveRealEligibility(params: {
  signalType: schema.TradingSignal['signalType'];
  validationState: TradingSignalPromotionValidationState;
  datasetVersionId: string | null;
  calibrationId: string | null;
  realPromotedAt: Date | null;
}): { status: TradingSignalEligibilityStatus; reasonCode: string | null } {
  if (params.realPromotedAt) {
    return { status: 'eligible', reasonCode: null };
  }
  if (!isDirectionalSignalType(params.signalType)) {
    return { status: 'blocked', reasonCode: 'NON_DIRECTIONAL_SIGNAL' };
  }
  if (params.validationState !== 'validated') {
    return { status: 'blocked', reasonCode: 'VALIDATION_NOT_VALIDATED' };
  }
  if (!params.datasetVersionId) {
    return { status: 'blocked', reasonCode: 'DATASET_VERSION_MISSING' };
  }
  if (!params.calibrationId) {
    return { status: 'blocked', reasonCode: 'CALIBRATION_MISSING' };
  }
  return { status: 'pending', reasonCode: 'REAL_PROMOTION_REQUIRED' };
}

function resolveDerivedLifecycleStage(params: {
  baseStage: TradingSignalPromotionStage;
  datasetCandidateId: string | null;
  datasetVersionId: string | null;
  calibrationId: string | null;
  demoPromotedAt: Date | null;
  realPromotedAt: Date | null;
}): TradingSignalPromotionStage {
  let stage: TradingSignalPromotionStage = params.baseStage;

  if (params.datasetCandidateId) stage = 'dataset_candidate';
  if (params.datasetVersionId) stage = 'approved_dataset_version';
  if (params.calibrationId) stage = 'calibration_result';
  if (params.demoPromotedAt) stage = 'demo_eligible';
  if (params.realPromotedAt) stage = 'real_eligible';

  return stage;
}

function getPromotionReasonHuman(reasonCode: string | null): string | null {
  if (!reasonCode) return null;
  return promotionReasonHumanMap[reasonCode] ?? null;
}

export class TradingSignalPromotionError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TradingSignalPromotionError';
    this.code = code;
  }
}

type TradingAuthContext = { tenantId: string; userId: string };

export type TradingSignalPromotionPathSummary = {
  path: schema.TradingSignalPromotion;
  signalId: string;
  lifecycleStage: TradingSignalPromotionStage;
  validationState: TradingSignalPromotionValidationState;
  datasetCandidate: {
    id: string | null;
    status: schema.TrainingData['status'] | null;
  };
  datasetVersionId: string | null;
  calibration: {
    id: string | null;
    evalMetrics: Record<string, unknown> | null;
  };
  demo: {
    status: TradingSignalEligibilityStatus;
    reasonCode: string | null;
    reasonHuman: string | null;
    orderId: string | null;
    promotedAt: string | null;
    promotedByUserId: string | null;
  };
  real: {
    status: TradingSignalEligibilityStatus;
    reasonCode: string | null;
    reasonHuman: string | null;
    promotedAt: string | null;
    promotedByUserId: string | null;
  };
  events: schema.TradingSignalPromotionEvent[];
};

export function createTradingSignalPromotionService() {
  const db = getDatabase();

  async function recordPromotionEvent(params: {
    authContext: TradingAuthContext;
    path: schema.TradingSignalPromotion;
    lifecycleStage: TradingSignalPromotionStage;
    reason?: string;
    evidenceSourceType: string;
    evidenceSourceId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await db.insert(schema.tradingSignalPromotionEvents).values({
      tenantId: params.authContext.tenantId,
      promotionPathId: params.path.id,
      signalId: params.path.signalId,
      lifecycleStage: params.lifecycleStage,
      actorUserId: params.authContext.userId,
      reason: params.reason ?? null,
      evidenceSourceType: params.evidenceSourceType,
      evidenceSourceId: params.evidenceSourceId,
      metadata: params.metadata ?? {},
    });
  }

  async function mirrorPromotionSnapshotToSignalMetadata(params: {
    authContext: TradingAuthContext;
    signal: schema.TradingSignal;
    path: schema.TradingSignalPromotion;
  }): Promise<void> {
    const metadata = (params.signal.metadata ?? {}) as TradingSignalMetadata;
    const nextMetadata: TradingSignalMetadata = {
      ...metadata,
      promotion: {
        pathId: params.path.id,
        lifecycleStage: params.path.lifecycleStage,
        validationState: params.path.validationState,
        datasetCandidateId: params.path.datasetCandidateId ?? undefined,
        datasetVersionId: params.path.datasetVersionId ?? undefined,
        calibrationId: params.path.calibrationId ?? undefined,
        demoEligibilityStatus: params.path.demoEligibilityStatus,
        demoEligibilityReasonCode: params.path.demoEligibilityReasonCode ?? undefined,
        demoOrderId: params.path.demoOrderId ?? undefined,
        demoPromotedByUserId: params.path.demoPromotedByUserId ?? undefined,
        demoPromotedAt: params.path.demoPromotedAt?.toISOString(),
        demoPromotionReason: params.path.demoPromotionReason ?? undefined,
        realEligibilityStatus: params.path.realEligibilityStatus,
        realEligibilityReasonCode: params.path.realEligibilityReasonCode ?? undefined,
        realPromotedByUserId: params.path.realPromotedByUserId ?? undefined,
        realPromotedAt: params.path.realPromotedAt?.toISOString(),
        realPromotionReason: params.path.realPromotionReason ?? undefined,
      },
    };

    await db.update(schema.tradingSignals)
      .set({ metadata: nextMetadata })
      .where(and(
        eq(schema.tradingSignals.id, params.signal.id),
        eq(schema.tradingSignals.tenantId, params.authContext.tenantId),
      ));
  }

  async function findSignalById(params: { authContext: TradingAuthContext; signalId: string }): Promise<schema.TradingSignal> {
    const signal = await db.query.tradingSignals.findFirst({
      where: and(
        eq(schema.tradingSignals.id, params.signalId),
        eq(schema.tradingSignals.tenantId, params.authContext.tenantId),
      ),
    });

    if (!signal) {
      throw new TradingSignalPromotionError('SIGNAL_NOT_FOUND', 'Sinal não encontrado para promotion path.');
    }

    return signal;
  }

  async function findPromotionPath(params: {
    tenantId: string;
    signalId: string;
  }): Promise<schema.TradingSignalPromotion | null> {
    const existing = await db.query.tradingSignalPromotions.findFirst({
      where: and(
        eq(schema.tradingSignalPromotions.tenantId, params.tenantId),
        eq(schema.tradingSignalPromotions.signalId, params.signalId),
      ),
    });

    return existing ?? null;
  }

  async function findDatasetCandidateStatus(datasetCandidateId: string | null): Promise<schema.TrainingData['status'] | null> {
    if (!datasetCandidateId) return null;

    const dataset = await db.query.trainingData.findFirst({
      where: eq(schema.trainingData.id, datasetCandidateId),
      columns: { status: true },
    });

    return dataset?.status ?? null;
  }

  async function findDatasetVersionForCandidate(params: {
    tenantId: string;
    datasetCandidateId: string | null;
  }): Promise<string | null> {
    if (!params.datasetCandidateId) return null;

    const versions = await db.query.trainingDatasetVersions.findMany({
      where: eq(schema.trainingDatasetVersions.tenantId, params.tenantId),
      orderBy: [desc(schema.trainingDatasetVersions.createdAt)],
      limit: 200,
      columns: { id: true, manifest: true },
    });

    for (const version of versions) {
      if (manifestContainsTrainingDataId(version.manifest, params.datasetCandidateId)) {
        return version.id;
      }
    }

    return null;
  }

  async function findCalibrationForSignal(params: {
    tenantId: string;
    autoDecisionId: string | null;
  }): Promise<{ id: string; evalMetrics: Record<string, unknown> | null } | null> {
    if (!params.autoDecisionId) return null;

    const decision = await db.query.tradingAutoDecisions.findFirst({
      where: and(
        eq(schema.tradingAutoDecisions.id, params.autoDecisionId),
        eq(schema.tradingAutoDecisions.tenantId, params.tenantId),
      ),
      columns: { candidateIds: true },
    });

    const candidateIds = decision?.candidateIds ?? [];
    if (!candidateIds.length) return null;

    const candidates = await db.query.tradingUniverseCandidates.findMany({
      where: and(
        eq(schema.tradingUniverseCandidates.tenantId, params.tenantId),
        inArray(schema.tradingUniverseCandidates.id, candidateIds),
      ),
      orderBy: [desc(schema.tradingUniverseCandidates.createdAt)],
      limit: 10,
      columns: {
        instrumentId: true,
        marketType: true,
        operationIntent: true,
        strategyKey: true,
        strategyVersion: true,
      },
    });

    for (const candidate of candidates) {
      const calibration = await db.query.tradingSignalCalibration.findFirst({
        where: and(
          eq(schema.tradingSignalCalibration.tenantId, params.tenantId),
          eq(schema.tradingSignalCalibration.instrumentId, candidate.instrumentId),
          eq(schema.tradingSignalCalibration.marketType, candidate.marketType),
          eq(schema.tradingSignalCalibration.operationIntent, candidate.operationIntent),
          eq(schema.tradingSignalCalibration.strategyKey, candidate.strategyKey),
          eq(schema.tradingSignalCalibration.strategyVersion, candidate.strategyVersion),
        ),
        orderBy: [desc(schema.tradingSignalCalibration.createdAt)],
        columns: { id: true, evalMetrics: true },
      });

      if (calibration) {
        return {
          id: calibration.id,
          evalMetrics: calibration.evalMetrics as Record<string, unknown> | null,
        };
      }
    }

    return null;
  }

  async function ensureSignalPromotionPath(params: {
    authContext: TradingAuthContext;
    signal: schema.TradingSignal;
    reason?: string;
  }): Promise<schema.TradingSignalPromotion> {
    const evidence = resolveEvidenceSource(params.signal);
    const metadata = (params.signal.metadata ?? {}) as TradingSignalMetadata;
    const validationState = normalizeValidationState(metadata.validationStatus);

    const existing = await findPromotionPath({
      tenantId: params.authContext.tenantId,
      signalId: params.signal.id,
    });

    if (existing) {
      const [updated] = await db.update(schema.tradingSignalPromotions)
        .set({
          autoRunId: evidence.autoRunId,
          autoDecisionId: evidence.autoDecisionId,
          evidenceSourceType: evidence.evidenceSourceType,
          evidenceSourceId: evidence.evidenceSourceId,
          validationState,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.tradingSignalPromotions.id, existing.id),
          eq(schema.tradingSignalPromotions.tenantId, params.authContext.tenantId),
        ))
        .returning();

      return updated ?? existing;
    }

    const [created] = await db.insert(schema.tradingSignalPromotions).values({
      tenantId: params.authContext.tenantId,
      signalId: params.signal.id,
      autoRunId: evidence.autoRunId,
      autoDecisionId: evidence.autoDecisionId,
      evidenceSourceType: evidence.evidenceSourceType,
      evidenceSourceId: evidence.evidenceSourceId,
      validationState,
      lifecycleStage: 'candidate_evidence_captured',
      demoEligibilityStatus: 'pending',
      realEligibilityStatus: 'pending',
    }).returning();

    await recordPromotionEvent({
      authContext: params.authContext,
      path: created,
      lifecycleStage: 'candidate_evidence_captured',
      reason: params.reason ?? 'candidate evidence captured',
      evidenceSourceType: evidence.evidenceSourceType,
      evidenceSourceId: evidence.evidenceSourceId,
      metadata: {
        validationState,
      },
    });

    return created;
  }

  async function syncSignalPromotionPath(params: {
    authContext: TradingAuthContext;
    signal: schema.TradingSignal;
    reason?: string;
  }): Promise<schema.TradingSignalPromotion> {
    const ensured = await ensureSignalPromotionPath({
      authContext: params.authContext,
      signal: params.signal,
      reason: params.reason,
    });

    const datasetCandidateStatus = await findDatasetCandidateStatus(ensured.datasetCandidateId ?? null);
    const datasetVersionId = await findDatasetVersionForCandidate({
      tenantId: params.authContext.tenantId,
      datasetCandidateId: ensured.datasetCandidateId ?? null,
    });

    const calibration = await findCalibrationForSignal({
      tenantId: params.authContext.tenantId,
      autoDecisionId: ensured.autoDecisionId ?? null,
    });

    const metadata = (params.signal.metadata ?? {}) as TradingSignalMetadata;
    const validationState = normalizeValidationState(metadata.validationStatus);

    const demoEligibility = resolveDemoEligibility({
      signalType: params.signal.signalType,
      validationState,
      datasetCandidateId: ensured.datasetCandidateId ?? null,
      datasetCandidateStatus,
      datasetVersionId,
      calibrationId: calibration?.id ?? null,
    });

    const realEligibility = resolveRealEligibility({
      signalType: params.signal.signalType,
      validationState,
      datasetVersionId,
      calibrationId: calibration?.id ?? null,
      realPromotedAt: ensured.realPromotedAt ?? null,
    });

    const derivedStage = resolveDerivedLifecycleStage({
      baseStage: ensured.lifecycleStage,
      datasetCandidateId: ensured.datasetCandidateId ?? null,
      datasetVersionId,
      calibrationId: calibration?.id ?? null,
      demoPromotedAt: ensured.demoPromotedAt ?? null,
      realPromotedAt: ensured.realPromotedAt ?? null,
    });

    const lifecycleStage = getPromotionStageMax(ensured.lifecycleStage, derivedStage);

    const [updated] = await db.update(schema.tradingSignalPromotions)
      .set({
        validationState,
        datasetVersionId,
        calibrationId: calibration?.id ?? null,
        demoEligibilityStatus: demoEligibility.status,
        demoEligibilityReasonCode: demoEligibility.reasonCode,
        realEligibilityStatus: realEligibility.status,
        realEligibilityReasonCode: realEligibility.reasonCode,
        lifecycleStage,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.tradingSignalPromotions.id, ensured.id),
        eq(schema.tradingSignalPromotions.tenantId, params.authContext.tenantId),
      ))
      .returning();

    if (!updated) {
      return ensured;
    }

    if (updated.lifecycleStage !== ensured.lifecycleStage) {
      await recordPromotionEvent({
        authContext: params.authContext,
        path: updated,
        lifecycleStage: updated.lifecycleStage,
        reason: params.reason ?? `lifecycle advanced to ${updated.lifecycleStage}`,
        evidenceSourceType: updated.evidenceSourceType,
        evidenceSourceId: updated.evidenceSourceId,
        metadata: {
          validationState,
          datasetCandidateStatus,
          datasetVersionId,
          calibrationId: calibration?.id ?? null,
          demoEligibility: demoEligibility,
          realEligibility,
        },
      });
    }

    await mirrorPromotionSnapshotToSignalMetadata({
      authContext: params.authContext,
      signal: params.signal,
      path: updated,
    });

    return updated;
  }

  async function registerDatasetCandidate(params: {
    authContext: TradingAuthContext;
    signal: schema.TradingSignal;
    datasetCandidateId: string;
    reason?: string;
  }): Promise<schema.TradingSignalPromotion> {
    const ensured = await ensureSignalPromotionPath({
      authContext: params.authContext,
      signal: params.signal,
      reason: params.reason ?? 'dataset candidate created',
    });

    const [updated] = await db.update(schema.tradingSignalPromotions)
      .set({
        datasetCandidateId: params.datasetCandidateId,
        lifecycleStage: getPromotionStageMax(ensured.lifecycleStage, 'dataset_candidate'),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.tradingSignalPromotions.id, ensured.id),
        eq(schema.tradingSignalPromotions.tenantId, params.authContext.tenantId),
      ))
      .returning();

    if (updated) {
      await recordPromotionEvent({
        authContext: params.authContext,
        path: updated,
        lifecycleStage: 'dataset_candidate',
        reason: params.reason ?? 'signal routed to dataset curation',
        evidenceSourceType: updated.evidenceSourceType,
        evidenceSourceId: updated.evidenceSourceId,
        metadata: {
          datasetCandidateId: params.datasetCandidateId,
        },
      });

      const metadata = (params.signal.metadata ?? {}) as TradingSignalMetadata;
      const namespaceId = metadataNamespaceSchema.safeParse(metadata.namespaceId).success
        ? metadata.namespaceId
        : null;

      await db.insert(schema.trainingLineageEvents).values({
        tenantId: params.authContext.tenantId,
        namespaceId,
        eventType: 'trading_signal_dataset_candidate',
        sourceTable: 'trading_signals',
        sourceId: params.signal.id,
        producedTable: 'training_data',
        producedId: params.datasetCandidateId,
        metadata: {
          promotionPathId: updated.id,
          actorUserId: params.authContext.userId,
          reason: params.reason ?? null,
        },
      });

      return syncSignalPromotionPath({
        authContext: params.authContext,
        signal: params.signal,
        reason: 'dataset candidate synchronized',
      });
    }

    return syncSignalPromotionPath({
      authContext: params.authContext,
      signal: params.signal,
      reason: 'dataset candidate synchronization fallback',
    });
  }

  async function assertSignalDemoEligibility(params: {
    authContext: TradingAuthContext;
    signal: schema.TradingSignal;
  }): Promise<schema.TradingSignalPromotion> {
    const synced = await syncSignalPromotionPath({
      authContext: params.authContext,
      signal: params.signal,
      reason: 'demo eligibility check',
    });

    if (synced.demoEligibilityStatus !== 'eligible') {
      const reasonCode = synced.demoEligibilityReasonCode ?? 'DEMO_ELIGIBILITY_BLOCKED';
      const reasonHuman = getPromotionReasonHuman(reasonCode) ?? 'Sinal não está elegível para handoff de demo.';
      throw new TradingSignalPromotionError(reasonCode, reasonHuman);
    }

    return synced;
  }

  async function registerSignalDemoHandoff(params: {
    authContext: TradingAuthContext;
    signal: schema.TradingSignal;
    demoOrderId: string;
    reason?: string;
  }): Promise<schema.TradingSignalPromotion> {
    const eligible = await assertSignalDemoEligibility({
      authContext: params.authContext,
      signal: params.signal,
    });

    const [updated] = await db.update(schema.tradingSignalPromotions)
      .set({
        demoOrderId: params.demoOrderId,
        demoPromotedByUserId: params.authContext.userId,
        demoPromotedAt: new Date(),
        demoPromotionReason: params.reason ?? null,
        demoEligibilityStatus: 'eligible',
        demoEligibilityReasonCode: null,
        lifecycleStage: getPromotionStageMax(eligible.lifecycleStage, 'demo_eligible'),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.tradingSignalPromotions.id, eligible.id),
        eq(schema.tradingSignalPromotions.tenantId, params.authContext.tenantId),
      ))
      .returning();

    if (!updated) {
      throw new TradingSignalPromotionError('DEMO_HANDOFF_UPDATE_FAILED', 'Falha ao registrar handoff demo no promotion path.');
    }

    await recordPromotionEvent({
      authContext: params.authContext,
      path: updated,
      lifecycleStage: 'demo_eligible',
      reason: params.reason ?? 'signal routed to demo execution',
      evidenceSourceType: updated.evidenceSourceType,
      evidenceSourceId: updated.evidenceSourceId,
      metadata: {
        demoOrderId: params.demoOrderId,
      },
    });

    const metadata = (params.signal.metadata ?? {}) as TradingSignalMetadata;
    const namespaceId = metadataNamespaceSchema.safeParse(metadata.namespaceId).success
      ? metadata.namespaceId
      : null;

    await db.insert(schema.trainingLineageEvents).values({
      tenantId: params.authContext.tenantId,
      namespaceId,
      eventType: 'trading_signal_demo_handoff',
      sourceTable: 'trading_signals',
      sourceId: params.signal.id,
      producedTable: 'demo_orders',
      producedId: params.demoOrderId,
      metadata: {
        promotionPathId: updated.id,
        actorUserId: params.authContext.userId,
        reason: params.reason ?? null,
      },
    });

    await mirrorPromotionSnapshotToSignalMetadata({
      authContext: params.authContext,
      signal: params.signal,
      path: updated,
    });

    return updated;
  }

  async function promoteSignalRealEligibility(params: {
    authContext: TradingAuthContext;
    signal: schema.TradingSignal;
    reason: string;
  }): Promise<schema.TradingSignalPromotion> {
    const synced = await syncSignalPromotionPath({
      authContext: params.authContext,
      signal: params.signal,
      reason: 'real eligibility promotion check',
    });

    if (synced.validationState !== 'validated') {
      throw new TradingSignalPromotionError(
        'VALIDATION_NOT_VALIDATED',
        promotionReasonHumanMap.VALIDATION_NOT_VALIDATED,
      );
    }

    if (!synced.datasetVersionId) {
      throw new TradingSignalPromotionError(
        'DATASET_VERSION_MISSING',
        promotionReasonHumanMap.DATASET_VERSION_MISSING,
      );
    }

    if (!synced.calibrationId) {
      throw new TradingSignalPromotionError(
        'CALIBRATION_MISSING',
        promotionReasonHumanMap.CALIBRATION_MISSING,
      );
    }

    if (!isDirectionalSignalType(params.signal.signalType)) {
      throw new TradingSignalPromotionError(
        'NON_DIRECTIONAL_SIGNAL',
        promotionReasonHumanMap.NON_DIRECTIONAL_SIGNAL,
      );
    }

    const [updated] = await db.update(schema.tradingSignalPromotions)
      .set({
        lifecycleStage: 'real_eligible',
        realEligibilityStatus: 'eligible',
        realEligibilityReasonCode: null,
        realPromotedByUserId: params.authContext.userId,
        realPromotedAt: new Date(),
        realPromotionReason: params.reason,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.tradingSignalPromotions.id, synced.id),
        eq(schema.tradingSignalPromotions.tenantId, params.authContext.tenantId),
      ))
      .returning();

    if (!updated) {
      throw new TradingSignalPromotionError('REAL_PROMOTION_UPDATE_FAILED', 'Falha ao atualizar promoção para real eligibility.');
    }

    await recordPromotionEvent({
      authContext: params.authContext,
      path: updated,
      lifecycleStage: 'real_eligible',
      reason: params.reason,
      evidenceSourceType: updated.evidenceSourceType,
      evidenceSourceId: updated.evidenceSourceId,
      metadata: {
        realPromotedByUserId: params.authContext.userId,
      },
    });

    const metadata = (params.signal.metadata ?? {}) as TradingSignalMetadata;
    const namespaceId = metadataNamespaceSchema.safeParse(metadata.namespaceId).success
      ? metadata.namespaceId
      : null;

    await db.insert(schema.trainingLineageEvents).values({
      tenantId: params.authContext.tenantId,
      namespaceId,
      eventType: 'trading_signal_real_eligibility_promoted',
      sourceTable: 'trading_signals',
      sourceId: params.signal.id,
      producedTable: 'trading_signal_promotions',
      producedId: updated.id,
      metadata: {
        actorUserId: params.authContext.userId,
        reason: params.reason,
        datasetVersionId: updated.datasetVersionId,
        calibrationId: updated.calibrationId,
      },
    });

    await mirrorPromotionSnapshotToSignalMetadata({
      authContext: params.authContext,
      signal: params.signal,
      path: updated,
    });

    return updated;
  }

  async function getSignalPromotionPath(params: {
    authContext: TradingAuthContext;
    signalId: string;
  }): Promise<TradingSignalPromotionPathSummary> {
    const signal = await findSignalById(params);
    const synced = await syncSignalPromotionPath({
      authContext: params.authContext,
      signal,
      reason: 'promotion path queried',
    });

    const datasetCandidateStatus = await findDatasetCandidateStatus(synced.datasetCandidateId ?? null);
    const calibration = synced.calibrationId
      ? await db.query.tradingSignalCalibration.findFirst({
        where: eq(schema.tradingSignalCalibration.id, synced.calibrationId),
        columns: { id: true, evalMetrics: true },
      })
      : null;

    const events = await db.query.tradingSignalPromotionEvents.findMany({
      where: and(
        eq(schema.tradingSignalPromotionEvents.tenantId, params.authContext.tenantId),
        eq(schema.tradingSignalPromotionEvents.signalId, signal.id),
      ),
      orderBy: [desc(schema.tradingSignalPromotionEvents.createdAt)],
      limit: 100,
    });

    return {
      path: synced,
      signalId: signal.id,
      lifecycleStage: synced.lifecycleStage,
      validationState: synced.validationState,
      datasetCandidate: {
        id: synced.datasetCandidateId ?? null,
        status: datasetCandidateStatus,
      },
      datasetVersionId: synced.datasetVersionId ?? null,
      calibration: {
        id: calibration?.id ?? null,
        evalMetrics: (calibration?.evalMetrics as Record<string, unknown> | null) ?? null,
      },
      demo: {
        status: synced.demoEligibilityStatus,
        reasonCode: synced.demoEligibilityReasonCode ?? null,
        reasonHuman: getPromotionReasonHuman(synced.demoEligibilityReasonCode ?? null),
        orderId: synced.demoOrderId ?? null,
        promotedAt: synced.demoPromotedAt?.toISOString() ?? null,
        promotedByUserId: synced.demoPromotedByUserId ?? null,
      },
      real: {
        status: synced.realEligibilityStatus,
        reasonCode: synced.realEligibilityReasonCode ?? null,
        reasonHuman: getPromotionReasonHuman(synced.realEligibilityReasonCode ?? null),
        promotedAt: synced.realPromotedAt?.toISOString() ?? null,
        promotedByUserId: synced.realPromotedByUserId ?? null,
      },
      events,
    };
  }

  return {
    findSignalById,
    ensureSignalPromotionPath,
    syncSignalPromotionPath,
    registerDatasetCandidate,
    assertSignalDemoEligibility,
    registerSignalDemoHandoff,
    promoteSignalRealEligibility,
    getSignalPromotionPath,
  };
}

export {
  getPromotionReasonHuman,
  manifestContainsTrainingDataId,
  normalizeValidationState,
  resolveDemoEligibility,
  resolveDerivedLifecycleStage,
  resolveRealEligibility,
};
