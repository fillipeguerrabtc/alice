import { createLogger } from '@alice/logger';
import { getDatabase, schema, and, desc, eq, isNull } from '@alice/database';

const logger = createLogger('training-dataset-selection-engine');

export interface SelectionScope {
  tenantId: string;
  namespaceId: string;
  agentId?: string | null;
  domain?: string | null;
}

export interface SelectionExample {
  id: string;
  sourceType: string | null;
  sourceMetadata: Record<string, unknown> | null;
  qualityScore: number | null;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

export interface SelectionResult {
  selected: SelectionExample[];
  profileVersion: number | null;
  diagnostics: {
    total: number;
    selected: number;
    skippedByExclusion: number;
    selectedBySourceType: Record<string, number>;
  };
}

interface ProfileConfig {
  version: number;
  weights: Record<string, number>;
  keywords: string[];
  exclusions: string[];
  samplingPolicy: Record<string, unknown>;
}

const DEFAULT_PROFILE: ProfileConfig = {
  version: 1,
  weights: {
    quality: 0.5,
    keyword: 0.3,
    diversity: 0.2,
  },
  keywords: [],
  exclusions: [],
  samplingPolicy: {
    perSourceTypeCap: 500,
  },
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textFromMessages(messages: Array<{ content: string }>): string {
  return normalize(messages.map((m) => m.content).join('\n'));
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function loadProfile(scope: SelectionScope): Promise<ProfileConfig> {
  const db = getDatabase();
  // Precedência enterprise: profile de agente sempre tem prioridade sobre profile de namespace.
  // Fallback para namespace só ocorre quando NÃO existe profile ativo específico do agente.
  const profile = scope.agentId
    ? (await db.query.trainingDatasetProfiles.findFirst({
        where: and(
          eq(schema.trainingDatasetProfiles.tenantId, scope.tenantId),
          eq(schema.trainingDatasetProfiles.namespaceId, scope.namespaceId),
          eq(schema.trainingDatasetProfiles.isActive, true),
          eq(schema.trainingDatasetProfiles.agentId, scope.agentId)
        ),
        orderBy: [desc(schema.trainingDatasetProfiles.version)],
      })) ??
      (await db.query.trainingDatasetProfiles.findFirst({
        where: and(
          eq(schema.trainingDatasetProfiles.tenantId, scope.tenantId),
          eq(schema.trainingDatasetProfiles.namespaceId, scope.namespaceId),
          eq(schema.trainingDatasetProfiles.isActive, true),
          isNull(schema.trainingDatasetProfiles.agentId)
        ),
        orderBy: [desc(schema.trainingDatasetProfiles.version)],
      }))
    : await db.query.trainingDatasetProfiles.findFirst({
        where: and(
          eq(schema.trainingDatasetProfiles.tenantId, scope.tenantId),
          eq(schema.trainingDatasetProfiles.namespaceId, scope.namespaceId),
          eq(schema.trainingDatasetProfiles.isActive, true),
          isNull(schema.trainingDatasetProfiles.agentId)
        ),
        orderBy: [desc(schema.trainingDatasetProfiles.version)],
      });

  if (!profile) return DEFAULT_PROFILE;

  return {
    version: profile.version ?? 1,
    weights: {
      ...DEFAULT_PROFILE.weights,
      ...((profile.weights ?? {}) as Record<string, number>),
    },
    keywords: Array.isArray(profile.keywords) ? profile.keywords : [],
    exclusions: Array.isArray(profile.exclusions) ? profile.exclusions : [],
    samplingPolicy: {
      ...DEFAULT_PROFILE.samplingPolicy,
      ...((profile.samplingPolicy ?? {}) as Record<string, unknown>),
    },
  };
}

function scoreExample(profile: ProfileConfig, example: SelectionExample, sourceTypeCount: number): number {
  const content = textFromMessages(example.messages);
  const quality = Math.max(0, Math.min(1, safeNumber(example.qualityScore, 0.5)));

  let keywordHits = 0;
  for (const keyword of profile.keywords) {
    if (keyword && content.includes(normalize(keyword))) keywordHits += 1;
  }
  const keywordScore = profile.keywords.length > 0 ? Math.min(1, keywordHits / profile.keywords.length) : 0.5;

  // Quanto maior a frequência do tipo no corpus, menor o score para manter diversidade.
  // Isso evita concentração de fontes super-representadas na fase de ordenação inicial.
  const diversityScore = Math.max(0, 1 - sourceTypeCount / 1000);

  return (
    quality * safeNumber(profile.weights.quality, 0.5) +
    keywordScore * safeNumber(profile.weights.keyword, 0.3) +
    diversityScore * safeNumber(profile.weights.diversity, 0.2)
  );
}

function isExcluded(profile: ProfileConfig, example: SelectionExample): boolean {
  if (!profile.exclusions.length) return false;
  const content = textFromMessages(example.messages);
  return profile.exclusions.some((rule) => {
    const normalized = normalize(rule);
    return normalized.length > 0 && content.includes(normalized);
  });
}

export async function selectExamplesByProfile(
  scope: SelectionScope,
  _sourceType: string,
  corpus: SelectionExample[]
): Promise<SelectionResult> {
  const profile = await loadProfile(scope);
  const perSourceTypeCap = Math.max(
    1,
    Math.floor(safeNumber(profile.samplingPolicy.perSourceTypeCap, 500))
  );

  const selectedBySourceType: Record<string, number> = {};
  let skippedByExclusion = 0;
  const sourceTypeFrequency: Record<string, number> = {};
  for (const example of corpus) {
    const sourceTypeKey = example.sourceType ?? 'unknown';
    sourceTypeFrequency[sourceTypeKey] = (sourceTypeFrequency[sourceTypeKey] ?? 0) + 1;
  }

  const sorted = [...corpus]
    .map((example) => {
      const sourceTypeKey = example.sourceType ?? 'unknown';
      const sourceTypeCount = sourceTypeFrequency[sourceTypeKey] ?? 0;
      const score = scoreExample(profile, example, sourceTypeCount);
      return { example, score };
    })
    .sort((a, b) => b.score - a.score);

  const selected: SelectionExample[] = [];
  for (const item of sorted) {
    const sourceTypeKey = item.example.sourceType ?? 'unknown';
    const current = selectedBySourceType[sourceTypeKey] ?? 0;
    if (current >= perSourceTypeCap) {
      continue;
    }
    if (isExcluded(profile, item.example)) {
      skippedByExclusion += 1;
      continue;
    }
    selected.push(item.example);
    selectedBySourceType[sourceTypeKey] = current + 1;
  }

  logger.info(
    {
      tenantId: scope.tenantId,
      namespaceId: scope.namespaceId,
      agentId: scope.agentId ?? null,
      domain: scope.domain ?? null,
      profileVersion: profile.version,
      total: corpus.length,
      selected: selected.length,
      skippedByExclusion,
    },
    'Seleção de dataset por perfil concluída'
  );

  return {
    selected,
    profileVersion: profile.version,
    diagnostics: {
      total: corpus.length,
      selected: selected.length,
      skippedByExclusion,
      selectedBySourceType,
    },
  };
}
