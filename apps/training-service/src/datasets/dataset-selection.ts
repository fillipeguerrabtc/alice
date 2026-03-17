import { createHash } from 'node:crypto';
import {
  and,
  eq,
  getDatabase,
  inArray,
  isNull,
  not,
  or,
  schema,
  sql,
  type InferSelectModel,
} from '@alice/database';
import { createLogger } from '@alice/logger';
import type { DatasetSplitPolicy, TrainingDatasetManifest } from '@alice/shared';
import { buildWalkForwardPlan } from '../trading/validation/walk-forward.js';
import {
  buildTradingDataEligibilityConditions,
  buildTradingTrainingSourceCondition,
  isTradingTrainingRow,
  loadTradingDataGovernancePolicyFromEnv,
} from '../trading-data-governance.js';

const logger = createLogger('training-canonical-dataset-selection');

const DEFAULT_HOLDOUT_RATIO = 0.1;
const DEFAULT_PURGE_BARS = 5;
const DEFAULT_EMBARGO_BARS = 2;

type TrainingDataRow = Pick<
  InferSelectModel<typeof schema.trainingData>,
  'id' | 'sourceType' | 'semhash' | 'criadoEm' | 'messages' | 'sourceMetadata' | 'purpose'
>;

export interface DatasetSelectionScope {
  tenantId: string;
  namespaceId?: string | null;
  agentId?: string | null;
  domain?: string | null;
}

export interface DatasetSelectionOptions {
  includeTradingDataset?: boolean;
  datasetMaxRows: number;
  trainEvalSplitRatio: number;
  minDatasetSize: number;
  seed: string;
  holdoutRatio?: number;
  splitPolicy?: DatasetSplitPolicy;
  inputRows?: TrainingDataRow[];
  profileId?: string | null;
  profileVersion?: number;
}

interface CanonicalDatasetRow {
  id: string;
  sourceType: string | null;
  semhash: string | null;
  createdAt: Date | null;
  text: string;
}

interface CanonicalDatasetSplit {
  splitPolicy: DatasetSplitPolicy;
  trainRows: CanonicalDatasetRow[];
  validationRows: CanonicalDatasetRow[];
  holdoutRows: CanonicalDatasetRow[];
  eligibleRows: CanonicalDatasetRow[];
  sourceCounts: Record<string, number>;
  dataWindow: { from: Date | null; to: Date | null };
}

export interface CanonicalDatasetPlan {
  splitPolicy: DatasetSplitPolicy;
  sourceCounts: Record<string, number>;
  dataWindow: { from: Date | null; to: Date | null };
  trainRows: CanonicalDatasetRow[];
  validationRows: CanonicalDatasetRow[];
  holdoutRows: CanonicalDatasetRow[];
  manifest: TrainingDatasetManifest;
  datasetHash: string;
}

export interface PersistedDatasetSnapshot extends CanonicalDatasetPlan {
  datasetVersionId: string;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function buildChatMlText(messages: Array<{ role: string; content: string }>): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join('\n');
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function deterministicUnit(seed: string, rowId: string): number {
  const digest = createHash('sha256').update(`${seed}:${rowId}`).digest();
  const value = digest.readUInt32BE(0);
  return value / 0xffffffff;
}

function sanitizeHoldoutRatio(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_HOLDOUT_RATIO;
  if (value < 0.05) return 0.05;
  if (value > 0.3) return 0.3;
  return value;
}

function buildJsonlText(text: string): string {
  return JSON.stringify({ text });
}

function dedupeRowsBySemhash(rows: CanonicalDatasetRow[]): CanonicalDatasetRow[] {
  const seen = new Set<string>();
  const deduped: CanonicalDatasetRow[] = [];
  for (const row of rows) {
    const key = row.semhash ?? row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function ensureNonEmptySplit(params: {
  trainRows: CanonicalDatasetRow[];
  validationRows: CanonicalDatasetRow[];
  holdoutRows: CanonicalDatasetRow[];
}): {
  trainRows: CanonicalDatasetRow[];
  validationRows: CanonicalDatasetRow[];
  holdoutRows: CanonicalDatasetRow[];
} {
  const trainRows = [...params.trainRows];
  const validationRows = [...params.validationRows];
  const holdoutRows = [...params.holdoutRows];

  if (trainRows.length === 0 && (validationRows.length > 1 || holdoutRows.length > 1)) {
    const fromValidation = validationRows.shift();
    if (fromValidation) trainRows.push(fromValidation);
  }
  if (validationRows.length === 0 && trainRows.length > 1) {
    const moved = trainRows.pop();
    if (moved) validationRows.push(moved);
  }
  if (holdoutRows.length === 0 && trainRows.length > 2) {
    const moved = trainRows.pop();
    if (moved) holdoutRows.push(moved);
  }

  return { trainRows, validationRows, holdoutRows };
}

function removeCrossSplitContamination(params: {
  trainRows: CanonicalDatasetRow[];
  validationRows: CanonicalDatasetRow[];
  holdoutRows: CanonicalDatasetRow[];
}): {
  trainRows: CanonicalDatasetRow[];
  validationRows: CanonicalDatasetRow[];
  holdoutRows: CanonicalDatasetRow[];
} {
  const trainKeys = new Set(params.trainRows.map((row) => row.semhash ?? row.id));
  const validationRows = params.validationRows.filter((row) => {
    const key = row.semhash ?? row.id;
    if (trainKeys.has(key)) return false;
    trainKeys.add(key);
    return true;
  });
  const trainAndValidation = new Set([...params.trainRows, ...validationRows].map((row) => row.semhash ?? row.id));
  const holdoutRows = params.holdoutRows.filter((row) => {
    const key = row.semhash ?? row.id;
    if (trainAndValidation.has(key)) return false;
    trainAndValidation.add(key);
    return true;
  });

  return ensureNonEmptySplit({
    trainRows: params.trainRows,
    validationRows,
    holdoutRows,
  });
}

function splitChatDeterministic(params: {
  rows: CanonicalDatasetRow[];
  seed: string;
  trainEvalSplitRatio: number;
  holdoutRatio: number;
}): {
  trainRows: CanonicalDatasetRow[];
  validationRows: CanonicalDatasetRow[];
  holdoutRows: CanonicalDatasetRow[];
} {
  const assignableRatio = 1 - params.holdoutRatio;
  const trainRatio = assignableRatio * params.trainEvalSplitRatio;

  const scored = params.rows
    .map((row) => ({ row, score: deterministicUnit(params.seed, row.id) }))
    .sort((left, right) => left.score - right.score);

  const trainRows: CanonicalDatasetRow[] = [];
  const validationRows: CanonicalDatasetRow[] = [];
  const holdoutRows: CanonicalDatasetRow[] = [];

  for (const entry of scored) {
    if (entry.score < trainRatio) {
      trainRows.push(entry.row);
    } else if (entry.score < assignableRatio) {
      validationRows.push(entry.row);
    } else {
      holdoutRows.push(entry.row);
    }
  }

  return ensureNonEmptySplit({ trainRows, validationRows, holdoutRows });
}

function splitTradingTemporal(params: {
  rows: CanonicalDatasetRow[];
  trainEvalSplitRatio: number;
  holdoutRatio: number;
  purgeBars?: number;
  embargoBars?: number;
}): {
  trainRows: CanonicalDatasetRow[];
  validationRows: CanonicalDatasetRow[];
  holdoutRows: CanonicalDatasetRow[];
} {
  const sorted = [...params.rows].sort((left, right) => {
    const leftTime = left.createdAt?.getTime() ?? 0;
    const rightTime = right.createdAt?.getTime() ?? 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });

  if (sorted.length <= 3) {
    return ensureNonEmptySplit({
      trainRows: sorted.slice(0, Math.max(1, sorted.length - 2)),
      validationRows: sorted.slice(Math.max(1, sorted.length - 2), Math.max(2, sorted.length - 1)),
      holdoutRows: sorted.slice(Math.max(2, sorted.length - 1)),
    });
  }

  const holdoutCount = Math.max(1, Math.floor(sorted.length * params.holdoutRatio));
  const assignableCount = Math.max(1, sorted.length - holdoutCount);
  const validationCount = Math.max(1, Math.floor(assignableCount * (1 - params.trainEvalSplitRatio)));
  const trainCount = Math.max(1, assignableCount - validationCount);

  let trainRows = sorted.slice(0, trainCount);
  let validationRows = sorted.slice(trainCount, trainCount + validationCount);
  const holdoutRows = sorted.slice(trainCount + validationCount);

  const purgeBars = Math.max(0, params.purgeBars ?? 0);
  const embargoBars = Math.max(0, params.embargoBars ?? 0);

  if (purgeBars > 0 && trainRows.length > purgeBars) {
    trainRows = trainRows.slice(0, trainRows.length - purgeBars);
  }
  if (embargoBars > 0 && validationRows.length > embargoBars) {
    validationRows = validationRows.slice(embargoBars);
  }

  return ensureNonEmptySplit({ trainRows, validationRows, holdoutRows });
}

function splitTradingWalkForward(params: {
  rows: CanonicalDatasetRow[];
  holdoutRatio: number;
}): {
  trainRows: CanonicalDatasetRow[];
  validationRows: CanonicalDatasetRow[];
  holdoutRows: CanonicalDatasetRow[];
} {
  const sorted = [...params.rows].sort((left, right) => {
    const leftTime = left.createdAt?.getTime() ?? 0;
    const rightTime = right.createdAt?.getTime() ?? 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });

  const timestamps = sorted.map((row) => row.createdAt?.getTime() ?? 0);
  const plan = buildWalkForwardPlan(timestamps, 3, DEFAULT_PURGE_BARS, DEFAULT_EMBARGO_BARS);
  if (plan.splits.length === 0) {
    return splitTradingTemporal({
      rows: sorted,
      trainEvalSplitRatio: 0.9,
      holdoutRatio: params.holdoutRatio,
      purgeBars: DEFAULT_PURGE_BARS,
      embargoBars: DEFAULT_EMBARGO_BARS,
    });
  }

  const lastSplit = plan.splits[plan.splits.length - 1];
  const trainRows = sorted.filter((row) => (row.createdAt?.getTime() ?? 0) <= lastSplit.trainEnd);
  const validationRows = sorted.filter((row) => {
    const time = row.createdAt?.getTime() ?? 0;
    return time >= lastSplit.testStart && time <= lastSplit.testEnd;
  });

  const holdoutCutoffIndex = Math.max(0, Math.floor(sorted.length * (1 - params.holdoutRatio)));
  const holdoutCandidates = sorted.slice(holdoutCutoffIndex);
  const validationKeys = new Set(validationRows.map((row) => row.id));
  const holdoutRows = holdoutCandidates.filter((row) => !validationKeys.has(row.id));

  return ensureNonEmptySplit({ trainRows, validationRows, holdoutRows });
}

function resolveSplitPolicy(params: {
  requested?: DatasetSplitPolicy;
  hasChat: boolean;
  hasTrading: boolean;
}): DatasetSplitPolicy {
  if (params.requested) return params.requested;
  if (params.hasChat && params.hasTrading) return 'mixed_hybrid';
  if (params.hasTrading) return 'trading_temporal';
  return 'chat_deterministic_hash';
}

function buildSourceCounts(rows: CanonicalDatasetRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = row.sourceType ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function buildDataWindow(rows: CanonicalDatasetRow[]): { from: Date | null; to: Date | null } {
  const sorted = [...rows].sort((left, right) => {
    const leftTime = left.createdAt?.getTime() ?? 0;
    const rightTime = right.createdAt?.getTime() ?? 0;
    return leftTime - rightTime;
  });
  return {
    from: sorted[0]?.createdAt ?? null,
    to: sorted[sorted.length - 1]?.createdAt ?? null,
  };
}

function toManifestRows(rows: CanonicalDatasetRow[]): TrainingDatasetManifest['rows']['train'] {
  return rows.map((row) => ({
    id: row.id,
    sourceType: row.sourceType,
    semhash: row.semhash,
    text: row.text,
    createdAt: toIso(row.createdAt),
  }));
}

function buildManifest(params: {
  splitPolicy: DatasetSplitPolicy;
  seed: string;
  scope: DatasetSelectionScope;
  trainRows: CanonicalDatasetRow[];
  validationRows: CanonicalDatasetRow[];
  holdoutRows: CanonicalDatasetRow[];
  sourceCounts: Record<string, number>;
}): TrainingDatasetManifest {
  const trainIds = params.trainRows.map((row) => row.id);
  const validationIds = params.validationRows.map((row) => row.id);
  const holdoutIds = params.holdoutRows.map((row) => row.id);

  const trainHash = hashText(trainIds.join(','));
  const validationHash = hashText(validationIds.join(','));
  const holdoutHash = hashText(holdoutIds.join(','));
  const manifestHash = hashText(
    JSON.stringify({
      policy: params.splitPolicy,
      seed: params.seed,
      trainHash,
      validationHash,
      holdoutHash,
      scope: params.scope,
    })
  );

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    seed: params.seed,
    splitPolicy: params.splitPolicy,
    scope: {
      tenantId: params.scope.tenantId,
      namespaceId: params.scope.namespaceId ?? null,
      agentId: params.scope.agentId ?? null,
    },
    totals: {
      eligible: trainIds.length + validationIds.length + holdoutIds.length,
      train: trainIds.length,
      validation: validationIds.length,
      holdout: holdoutIds.length,
    },
    hashes: {
      manifest: manifestHash,
      train: trainHash,
      validation: validationHash,
      holdout: holdoutHash,
    },
    sourceCounts: params.sourceCounts,
    rows: {
      train: toManifestRows(params.trainRows),
      validation: toManifestRows(params.validationRows),
      holdout: toManifestRows(params.holdoutRows),
    },
  };
}

async function loadEligibleRows(params: {
  scope: DatasetSelectionScope;
  options: DatasetSelectionOptions;
}): Promise<{ chatRows: TrainingDataRow[]; tradingRows: TrainingDataRow[] }> {
  if (params.options.inputRows) {
    const eligibleInputRows = params.options.inputRows.filter((row) => row.purpose === 'behavior_sft');
    const chatRows = eligibleInputRows.filter(
      (row) => !isTradingTrainingRow(row, params.scope.namespaceId ?? null)
    );
    const tradingRows = eligibleInputRows.filter(
      (row) => isTradingTrainingRow(row, params.scope.namespaceId ?? null)
    );
    return {
      chatRows,
      tradingRows,
    };
  }

  const db = getDatabase();
  const chatRows = await db.query.trainingData.findMany({
    where: and(
      eq(schema.trainingData.status, 'approved'),
      eq(schema.trainingData.purpose, 'behavior_sft'),
      eq(schema.trainingData.tenantId, params.scope.tenantId),
      isNull(schema.trainingData.usedInJobId),
      not(buildTradingTrainingSourceCondition(params.scope.namespaceId ?? null)),
      namespaceIdCondition(params.scope.namespaceId ?? null),
      agentIdCondition(params.scope.agentId ?? null),
      domainCondition(params.scope.domain ?? null)
    ),
    columns: {
      id: true,
      sourceType: true,
      semhash: true,
      criadoEm: true,
      messages: true,
      sourceMetadata: true,
      purpose: true,
    },
    limit: params.options.datasetMaxRows,
  });

  if (!params.options.includeTradingDataset || !params.scope.namespaceId) {
    return { chatRows, tradingRows: [] };
  }

  const tradingPolicy = loadTradingDataGovernancePolicyFromEnv();
  const tradingRows = await db
    .select({
      id: schema.trainingData.id,
      sourceType: schema.trainingData.sourceType,
      semhash: schema.trainingData.semhash,
      criadoEm: schema.trainingData.criadoEm,
      messages: schema.trainingData.messages,
      sourceMetadata: schema.trainingData.sourceMetadata,
      purpose: schema.trainingData.purpose,
    })
    .from(schema.trainingData)
    .where(and(
      ...buildTradingDataEligibilityConditions({
        tenantId: params.scope.tenantId,
        namespaceId: params.scope.namespaceId,
        policy: tradingPolicy,
      }),
      eq(schema.trainingData.purpose, 'behavior_sft'),
      isNull(schema.trainingData.usedInJobId),
      params.scope.agentId
        ? or(
            eq(schema.trainingData.agentId, params.scope.agentId),
            eq(schema.trainingData.inferredAgentId, params.scope.agentId)
          )
        : sql`TRUE`,
      params.scope.domain
        ? eq(schema.trainingData.inferredDomain, params.scope.domain)
        : sql`TRUE`
    ))
    .limit(params.options.datasetMaxRows);

  return {
    chatRows,
    tradingRows,
  };
}

function namespaceIdCondition(namespaceId: string | null): ReturnType<typeof or> | undefined {
  if (!namespaceId) return undefined;
  return or(
    eq(schema.trainingData.namespaceId, namespaceId),
    eq(schema.trainingData.inferredNamespaceId, namespaceId)
  );
}

function agentIdCondition(agentId: string | null): ReturnType<typeof or> | undefined {
  if (!agentId) return undefined;
  return or(
    eq(schema.trainingData.agentId, agentId),
    eq(schema.trainingData.inferredAgentId, agentId)
  );
}

function domainCondition(domain: string | null): ReturnType<typeof eq> | undefined {
  if (!domain) return undefined;
  return eq(schema.trainingData.inferredDomain, domain);
}

function toCanonicalRows(rows: TrainingDataRow[]): CanonicalDatasetRow[] {
  return rows
    .map((row) => {
      const messages = Array.isArray(row.messages)
        ? (row.messages as Array<{ role: string; content: string }>)
        : [];
      return {
        id: row.id,
        sourceType: row.sourceType,
        semhash: row.semhash,
        createdAt: row.criadoEm,
        text: buildJsonlText(buildChatMlText(messages)),
      };
    })
    .filter((row) => row.text.length > 0);
}

export async function planCanonicalDatasetSelection(params: {
  scope: DatasetSelectionScope;
  options: DatasetSelectionOptions;
}): Promise<CanonicalDatasetPlan> {
  const holdoutRatio = sanitizeHoldoutRatio(params.options.holdoutRatio);
  const loaded = await loadEligibleRows(params);
  const chatRows = dedupeRowsBySemhash(toCanonicalRows(loaded.chatRows));
  const tradingRows = dedupeRowsBySemhash(toCanonicalRows(loaded.tradingRows));

  const splitPolicy = resolveSplitPolicy({
    requested: params.options.splitPolicy,
    hasChat: chatRows.length > 0,
    hasTrading: tradingRows.length > 0,
  });

  let split: CanonicalDatasetSplit;
  if (splitPolicy === 'chat_deterministic_hash') {
    const splitResult = splitChatDeterministic({
      rows: chatRows,
      seed: params.options.seed,
      trainEvalSplitRatio: params.options.trainEvalSplitRatio,
      holdoutRatio,
    });
    split = {
      splitPolicy,
      trainRows: splitResult.trainRows,
      validationRows: splitResult.validationRows,
      holdoutRows: splitResult.holdoutRows,
      eligibleRows: chatRows,
      sourceCounts: buildSourceCounts(chatRows),
      dataWindow: buildDataWindow(chatRows),
    };
  } else if (splitPolicy === 'trading_temporal' || splitPolicy === 'trading_purged' || splitPolicy === 'walk_forward') {
    const tradingSplit = splitPolicy === 'walk_forward'
      ? splitTradingWalkForward({ rows: tradingRows, holdoutRatio })
      : splitTradingTemporal({
          rows: tradingRows,
          trainEvalSplitRatio: params.options.trainEvalSplitRatio,
          holdoutRatio,
          purgeBars: splitPolicy === 'trading_purged' ? DEFAULT_PURGE_BARS : 0,
          embargoBars: splitPolicy === 'trading_purged' ? DEFAULT_EMBARGO_BARS : 0,
        });
    split = {
      splitPolicy,
      trainRows: tradingSplit.trainRows,
      validationRows: tradingSplit.validationRows,
      holdoutRows: tradingSplit.holdoutRows,
      eligibleRows: tradingRows,
      sourceCounts: buildSourceCounts(tradingRows),
      dataWindow: buildDataWindow(tradingRows),
    };
  } else {
    const chatSplit = splitChatDeterministic({
      rows: chatRows,
      seed: `${params.options.seed}:chat`,
      trainEvalSplitRatio: params.options.trainEvalSplitRatio,
      holdoutRatio,
    });
    const tradingSplit = splitTradingTemporal({
      rows: tradingRows,
      trainEvalSplitRatio: params.options.trainEvalSplitRatio,
      holdoutRatio,
      purgeBars: DEFAULT_PURGE_BARS,
      embargoBars: DEFAULT_EMBARGO_BARS,
    });
    const cleaned = removeCrossSplitContamination({
      trainRows: [...chatSplit.trainRows, ...tradingSplit.trainRows],
      validationRows: [...chatSplit.validationRows, ...tradingSplit.validationRows],
      holdoutRows: [...chatSplit.holdoutRows, ...tradingSplit.holdoutRows],
    });
    const eligibleRows = dedupeRowsBySemhash([...chatRows, ...tradingRows]);
    split = {
      splitPolicy,
      trainRows: cleaned.trainRows,
      validationRows: cleaned.validationRows,
      holdoutRows: cleaned.holdoutRows,
      eligibleRows,
      sourceCounts: buildSourceCounts(eligibleRows),
      dataWindow: buildDataWindow(eligibleRows),
    };
  }

  const totalRows = split.trainRows.length + split.validationRows.length + split.holdoutRows.length;
  if (totalRows < params.options.minDatasetSize) {
    throw new Error(`Dataset insuficiente para treinamento: ${totalRows} exemplos. Minimo: ${params.options.minDatasetSize}`);
  }

  const manifest = buildManifest({
    splitPolicy: split.splitPolicy,
    seed: params.options.seed,
    scope: params.scope,
    trainRows: split.trainRows,
    validationRows: split.validationRows,
    holdoutRows: split.holdoutRows,
    sourceCounts: split.sourceCounts,
  });

  logger.info({
    tenantId: params.scope.tenantId,
    namespaceId: params.scope.namespaceId ?? null,
    agentId: params.scope.agentId ?? null,
    splitPolicy: split.splitPolicy,
    total: manifest.totals.eligible,
    train: manifest.totals.train,
    validation: manifest.totals.validation,
    holdout: manifest.totals.holdout,
  }, 'Dataset canonico selecionado');

  return {
    splitPolicy: split.splitPolicy,
    sourceCounts: split.sourceCounts,
    dataWindow: split.dataWindow,
    trainRows: split.trainRows,
    validationRows: split.validationRows,
    holdoutRows: split.holdoutRows,
    manifest,
    datasetHash: manifest.hashes.manifest,
  };
}

export async function persistCanonicalDatasetSnapshot(params: {
  scope: DatasetSelectionScope;
  options: DatasetSelectionOptions;
}): Promise<PersistedDatasetSnapshot> {
  const db = getDatabase();
  const plan = await planCanonicalDatasetSelection(params);

  const [datasetVersion] = await db.insert(schema.trainingDatasetVersions).values({
    tenantId: params.scope.tenantId,
    namespaceId: params.scope.namespaceId ?? null,
    agentId: params.scope.agentId ?? null,
    sourceCounts: plan.sourceCounts,
    dataWindow: {
      from: plan.dataWindow.from,
      to: plan.dataWindow.to,
    },
    profileId: params.options.profileId ?? null,
    profileVersion: params.options.profileVersion ?? 1,
    splitPolicy: plan.splitPolicy,
    manifest: plan.manifest,
    hash: plan.datasetHash,
  }).returning({ id: schema.trainingDatasetVersions.id });

  return {
    ...plan,
    datasetVersionId: datasetVersion.id,
  };
}

export async function reserveDatasetRowsForJob(params: {
  jobId: string;
  rowIds: string[];
}): Promise<void> {
  if (params.rowIds.length === 0) return;

  const db = getDatabase();
  const uniqueIds = Array.from(new Set(params.rowIds));
  const reservedRows = await db
    .update(schema.trainingData)
    .set({
      status: 'reserved',
      usedInJobId: params.jobId,
    })
    .where(and(
      inArray(schema.trainingData.id, uniqueIds),
      eq(schema.trainingData.status, 'approved'),
      isNull(schema.trainingData.usedInJobId)
    ))
    .returning({ id: schema.trainingData.id });

  if (reservedRows.length !== uniqueIds.length) {
    const reservedIds = new Set(reservedRows.map((row) => row.id));
    const missing = uniqueIds.filter((id) => !reservedIds.has(id));
    await releaseDatasetRowsForJob({ jobId: params.jobId });
    throw new Error(`Falha ao reservar dataset para job ${params.jobId}. IDs indisponiveis: ${missing.join(',')}`);
  }
}

export async function markDatasetRowsUsedForJob(params: {
  jobId: string;
  rowIds: string[];
}): Promise<void> {
  if (params.rowIds.length === 0) return;
  const db = getDatabase();
  await db
    .update(schema.trainingData)
    .set({
      status: 'used',
      processadoEm: new Date(),
      processedAt: new Date(),
      usedInJobId: params.jobId,
    })
    .where(and(
      inArray(schema.trainingData.id, Array.from(new Set(params.rowIds))),
      eq(schema.trainingData.status, 'reserved'),
      eq(schema.trainingData.usedInJobId, params.jobId)
    ));
}

export async function releaseDatasetRowsForJob(params: { jobId: string }): Promise<void> {
  const db = getDatabase();
  await db
    .update(schema.trainingData)
    .set({
      status: 'approved',
      usedInJobId: null,
    })
    .where(and(
      eq(schema.trainingData.usedInJobId, params.jobId),
      eq(schema.trainingData.status, 'reserved')
    ));
}
