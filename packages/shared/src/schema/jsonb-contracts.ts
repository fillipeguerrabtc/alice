/**
 * Contratos JSONB/Zod internos do schema compartilhado.
 *
 * Esta primeira fase de modularização extrai apenas contratos puros,
 * sem mover tabelas Drizzle, relations ou insert schemas.
 *
 * Autor: Fillipe Guerra
 * Data: 17 de Março de 2026
 */

import { z } from "zod";

// ============================================================================
// ZOD SCHEMAS PARA JSONB COLUMNS (TypeSafe - Fase 3 Enterprise 2025)
// Tipagem forte para todas as colunas JSONB no banco de dados
// ============================================================================

// --- Configurações de Tenant ---
export const HybridRoutingExceptionSchema = z.object({
  id: z.string().min(2).max(120),
  enabled: z.boolean().default(true),
  routePrefix: z.string().min(1).max(255).optional(),
  context: z.string().min(1).max(120).optional(),
  containsTerms: z.array(z.string().min(2).max(80)).max(80).default([]),
  action: z.enum(['force_namespace', 'require_human_review', 'bypass_transversal_default']),
  targetNamespaceSlug: z.string().min(2).max(100).optional(),
  note: z.string().max(500).optional(),
}).passthrough().superRefine((exception, ctx) => {
  if (exception.action === 'force_namespace' && !exception.targetNamespaceSlug) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'targetNamespaceSlug é obrigatório quando action=force_namespace',
      path: ['targetNamespaceSlug'],
    });
  }
});

export const HybridRoutingPolicySchema = z.object({
  version: z.number().int().positive().default(1),
  enabled: z.boolean().default(true),
  thresholds: z.object({
    autoAccept: z.number().min(0).max(1),
    humanReview: z.number().min(0).max(1),
    clusterAutoTagConfidence: z.number().min(0).max(1),
    clusterAutoTagMinSize: z.number().int().min(2).max(500),
  }).passthrough(),
  transversalDefault: z.object({
    enabled: z.boolean(),
    defaultNamespaceSlug: z.string().min(2).max(100),
    greetingsToDefault: z.boolean(),
    reuseGateToDefault: z.boolean(),
    domainExceptionTerms: z.array(z.string().min(2).max(80)).max(300),
  }).passthrough(),
  humanReview: z.object({
    enabled: z.boolean(),
    queueLowConfidenceRouting: z.boolean(),
    highRiskRoutes: z.array(z.string().min(1).max(255)).max(300),
  }).passthrough(),
  exceptions: z.array(HybridRoutingExceptionSchema).max(200).default([]),
}).superRefine((policy, ctx) => {
  if (policy.thresholds.humanReview > policy.thresholds.autoAccept) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'thresholds.humanReview deve ser <= thresholds.autoAccept',
      path: ['thresholds', 'humanReview'],
    });
  }
});
export type HybridRoutingPolicy = z.infer<typeof HybridRoutingPolicySchema>;

export const TenantConfiguracoesSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  logoPosition: z.enum(["left", "center"]).optional(),
  features: z.object({
    chat: z.boolean().optional(),
    rag: z.boolean().optional(),
    imageGen: z.boolean().optional(),
    training: z.boolean().optional(),
  }).optional(),
  customBranding: z.object({
    primaryColor: z.string().optional(),
    accentColor: z.string().optional(),
  }).optional(),
  hybridRouting: HybridRoutingPolicySchema.optional(),
}).passthrough();
export type TenantConfiguracoes = z.infer<typeof TenantConfiguracoesSchema>;

export const DASHBOARD_HOME_PREFERENCES_VERSION = 1 as const;

export const DASHBOARD_HOME_CARD_IDS = [
  'actionRequired',
  'supportQueue',
  'conversationTrend',
  'platformHealth',
  'recentActivity',
  'routingSnapshot',
  'trainingSnapshot',
  'financeSnapshot',
] as const;
export const DashboardHomeCardIdSchema = z.enum(DASHBOARD_HOME_CARD_IDS);
export type DashboardHomeCardId = z.infer<typeof DashboardHomeCardIdSchema>;

export const DASHBOARD_HOME_TIME_RANGES = ['24h', '7d', '14d', '30d'] as const;
export const DashboardHomeTimeRangeSchema = z.enum(DASHBOARD_HOME_TIME_RANGES);
export type DashboardHomeTimeRange = z.infer<typeof DashboardHomeTimeRangeSchema>;

export const DASHBOARD_HOME_METRIC_SETS = [
  'all',
  'platform',
  'support',
  'routing',
  'training',
  'overview',
  'urgent',
  'conversations',
  'tokens',
  'operations',
  'exceptions',
  'capacity',
  'cashflow',
] as const;
export const DashboardHomeMetricSetSchema = z.enum(DASHBOARD_HOME_METRIC_SETS);
export type DashboardHomeMetricSet = z.infer<typeof DashboardHomeMetricSetSchema>;

export const DASHBOARD_HOME_PERMISSION_KEYS = [
  'manageConversations',
  'openObservability',
  'viewTraining',
  'viewRouting',
  'viewFinance',
] as const;
export const DashboardHomePermissionKeySchema = z.enum(DASHBOARD_HOME_PERMISSION_KEYS);
export type DashboardHomePermissionKey = z.infer<typeof DashboardHomePermissionKeySchema>;

export type DashboardHomePermissionSnapshot = Partial<Record<DashboardHomePermissionKey, boolean>>;

export type DashboardHomeCardContract = {
  defaultEnabled: boolean;
  defaultLimit?: number;
  defaultMetricSet?: DashboardHomeMetricSet;
  defaultTimeRange?: DashboardHomeTimeRange;
  permissionGate: DashboardHomePermissionKey | null;
  priority: number;
  supportedLimits: readonly number[];
  supportedMetricSets: readonly DashboardHomeMetricSet[];
  supportedTimeRanges: readonly DashboardHomeTimeRange[];
};

export const DASHBOARD_HOME_CARD_CONTRACTS: Record<DashboardHomeCardId, DashboardHomeCardContract> = {
  actionRequired: {
    defaultEnabled: true,
    defaultMetricSet: 'all',
    permissionGate: null,
    priority: 10,
    supportedLimits: [3, 5],
    supportedMetricSets: ['all', 'platform', 'support', 'routing', 'training'],
    supportedTimeRanges: [],
  },
  supportQueue: {
    defaultEnabled: true,
    defaultMetricSet: 'overview',
    permissionGate: 'manageConversations',
    priority: 20,
    supportedLimits: [],
    supportedMetricSets: ['overview', 'urgent'],
    supportedTimeRanges: [],
  },
  conversationTrend: {
    defaultEnabled: true,
    defaultMetricSet: 'conversations',
    defaultTimeRange: '7d',
    permissionGate: 'manageConversations',
    priority: 30,
    supportedLimits: [],
    supportedMetricSets: ['conversations', 'tokens'],
    supportedTimeRanges: ['7d', '30d'],
  },
  platformHealth: {
    defaultEnabled: false,
    defaultMetricSet: 'overview',
    permissionGate: 'openObservability',
    priority: 40,
    supportedLimits: [],
    supportedMetricSets: ['overview', 'operations'],
    supportedTimeRanges: [],
  },
  recentActivity: {
    defaultEnabled: true,
    defaultLimit: 5,
    defaultMetricSet: 'operations',
    defaultTimeRange: '24h',
    permissionGate: null,
    priority: 50,
    supportedLimits: [5, 10],
    supportedMetricSets: ['all', 'operations'],
    supportedTimeRanges: ['24h', '7d', '30d'],
  },
  routingSnapshot: {
    defaultEnabled: false,
    defaultMetricSet: 'overview',
    defaultTimeRange: '7d',
    permissionGate: 'viewRouting',
    priority: 60,
    supportedLimits: [],
    supportedMetricSets: ['overview', 'exceptions'],
    supportedTimeRanges: ['24h', '7d', '14d'],
  },
  trainingSnapshot: {
    defaultEnabled: false,
    defaultMetricSet: 'overview',
    permissionGate: 'viewTraining',
    priority: 70,
    supportedLimits: [],
    supportedMetricSets: ['overview', 'capacity'],
    supportedTimeRanges: [],
  },
  financeSnapshot: {
    defaultEnabled: false,
    defaultMetricSet: 'overview',
    permissionGate: 'viewFinance',
    priority: 80,
    supportedLimits: [],
    supportedMetricSets: ['overview', 'cashflow'],
    supportedTimeRanges: [],
  },
};

export const DashboardHomeCardPreferencesSchema = z.object({
  enabled: z.boolean().optional(),
  timeRange: DashboardHomeTimeRangeSchema.optional(),
  metricSet: DashboardHomeMetricSetSchema.optional(),
  limit: z.number().int().min(1).max(20).optional(),
}).strict();
export type DashboardHomeCardPreferences = z.infer<typeof DashboardHomeCardPreferencesSchema>;
export type DashboardHomeResolvedCardPreferences = {
  enabled: boolean;
  timeRange?: DashboardHomeTimeRange;
  metricSet?: DashboardHomeMetricSet;
  limit?: number;
};

export const DashboardHomePreferencesSchema = z.object({
  version: z.literal(DASHBOARD_HOME_PREFERENCES_VERSION).default(DASHBOARD_HOME_PREFERENCES_VERSION),
  visibleCardIds: z.array(DashboardHomeCardIdSchema).max(DASHBOARD_HOME_CARD_IDS.length).optional(),
  cards: z.record(z.string(), DashboardHomeCardPreferencesSchema).optional(),
}).strict();
export type DashboardHomePreferences = z.infer<typeof DashboardHomePreferencesSchema>;
export type DashboardHomeResolvedPreferences = {
  version: typeof DASHBOARD_HOME_PREFERENCES_VERSION;
  visibleCardIds: DashboardHomeCardId[];
  cards: Record<DashboardHomeCardId, DashboardHomeResolvedCardPreferences>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDashboardHomeCardId(value: unknown): value is DashboardHomeCardId {
  return typeof value === 'string' && DASHBOARD_HOME_CARD_IDS.includes(value as DashboardHomeCardId);
}

function sanitizeDashboardHomeCardConfig(
  cardId: DashboardHomeCardId,
  rawValue: unknown,
): DashboardHomeResolvedCardPreferences {
  const contract = DASHBOARD_HOME_CARD_CONTRACTS[cardId];
  const rawConfig = isPlainObject(rawValue) ? rawValue : {};
  const sanitized: DashboardHomeResolvedCardPreferences = {
    enabled: typeof rawConfig.enabled === 'boolean' ? rawConfig.enabled : contract.defaultEnabled,
  };

  if (contract.defaultTimeRange) {
    sanitized.timeRange = contract.defaultTimeRange;
  }
  if (
    typeof rawConfig.timeRange === 'string'
    && contract.supportedTimeRanges.includes(rawConfig.timeRange as DashboardHomeTimeRange)
  ) {
    sanitized.timeRange = rawConfig.timeRange as DashboardHomeTimeRange;
  }

  if (contract.defaultMetricSet) {
    sanitized.metricSet = contract.defaultMetricSet;
  }
  if (
    typeof rawConfig.metricSet === 'string'
    && contract.supportedMetricSets.includes(rawConfig.metricSet as DashboardHomeMetricSet)
  ) {
    sanitized.metricSet = rawConfig.metricSet as DashboardHomeMetricSet;
  }

  if (typeof contract.defaultLimit === 'number') {
    sanitized.limit = contract.defaultLimit;
  }
  if (
    typeof rawConfig.limit === 'number'
    && Number.isInteger(rawConfig.limit)
    && contract.supportedLimits.includes(rawConfig.limit)
  ) {
    sanitized.limit = rawConfig.limit;
  }

  return sanitized;
}

export function isDashboardHomeCardAllowed(
  cardId: DashboardHomeCardId,
  permissions: DashboardHomePermissionSnapshot = {},
): boolean {
  const contract = DASHBOARD_HOME_CARD_CONTRACTS[cardId];
  if (!contract.permissionGate) {
    return true;
  }

  return permissions[contract.permissionGate] === true;
}

export function sanitizeDashboardHomePreferences(
  rawValue: unknown,
  permissions: DashboardHomePermissionSnapshot = {},
): DashboardHomeResolvedPreferences {
  const rawPreferences = isPlainObject(rawValue) ? rawValue : {};
  const rawCards = isPlainObject(rawPreferences.cards) ? rawPreferences.cards : {};
  const sanitizedCards = {} as Record<DashboardHomeCardId, DashboardHomeResolvedCardPreferences>;

  const allowedCardIds = DASHBOARD_HOME_CARD_IDS
    .filter((cardId) => isDashboardHomeCardAllowed(cardId, permissions))
    .sort((left, right) => DASHBOARD_HOME_CARD_CONTRACTS[left].priority - DASHBOARD_HOME_CARD_CONTRACTS[right].priority);

  for (const cardId of allowedCardIds) {
    sanitizedCards[cardId] = sanitizeDashboardHomeCardConfig(cardId, rawCards[cardId]);
  }

  const visibleCardIds: DashboardHomeCardId[] = [];
  const rawVisibleCardIds = Array.isArray(rawPreferences.visibleCardIds) ? rawPreferences.visibleCardIds : [];

  for (const rawCardId of rawVisibleCardIds) {
    if (!isDashboardHomeCardId(rawCardId)) {
      continue;
    }
    if (!allowedCardIds.includes(rawCardId)) {
      continue;
    }
    if (sanitizedCards[rawCardId]?.enabled !== true) {
      continue;
    }
    if (!visibleCardIds.includes(rawCardId)) {
      visibleCardIds.push(rawCardId);
    }
  }

  for (const cardId of allowedCardIds) {
    if (sanitizedCards[cardId]?.enabled !== true) {
      continue;
    }
    if (!visibleCardIds.includes(cardId)) {
      visibleCardIds.push(cardId);
    }
  }

  return {
    version: DASHBOARD_HOME_PREFERENCES_VERSION,
    visibleCardIds,
    cards: sanitizedCards,
  };
}

// --- Preferências de Usuário ---
export const UserPreferenciasSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  notificacoes: z.object({
    email: z.boolean().optional(),
    push: z.boolean().optional(),
    sound: z.boolean().optional(),
  }).optional(),
  training: z.object({
    allowTrainingUsage: z.boolean().optional(),
    allowAutoCollect: z.boolean().optional(),
  }).optional(),
  dashboardLayout: z.enum(["compact", "comfortable", "spacious"]).optional(),
  dashboardHome: DashboardHomePreferencesSchema.optional(),
  sidebarCollapsed: z.boolean().optional(),
  defaultNamespace: z.string().uuid().optional(),
  location: z.object({
    countryCode: z.string().length(2).regex(/^[A-Z]{2}$/).optional(),
    countryName: z.string().max(80).optional(),
    region: z.string().max(80).optional(),
    city: z.string().max(80).optional(),
  }).optional(),
}).passthrough();
export type UserPreferencias = z.infer<typeof UserPreferenciasSchema>;

// --- Configurações de Namespace ---
export const NamespaceConfiguracoesSchema = z.object({
  modelOverride: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  systemPromptPrefix: z.string().optional(),
  ragEnabled: z.boolean().optional(),
  imageGenEnabled: z.boolean().optional(),
}).passthrough();
export type NamespaceConfiguracoes = z.infer<typeof NamespaceConfiguracoesSchema>;

// --- Namespace Profile Config (Training Auto Collect Governance) ---
export const NamespaceProfileAutoCollectSchema = z.object({
  enabled: z.boolean(),
  requiresUserConsent: z.boolean(),
  sampling: z.object({
    enabled: z.boolean(),
    rate: z.number().min(0).max(1),
    deterministicKey: z.enum(['semhash', 'conversationId', 'messagePairHash']),
  }).passthrough(),
  caps: z.object({
    dailyTenantCap: z.number().int().positive(),
    dailyNamespaceCap: z.number().int().positive(),
    dailyUserCap: z.number().int().positive(),
  }).passthrough(),
  minChars: z.object({
    user: z.number().int().nonnegative(),
    assistant: z.number().int().nonnegative(),
  }).passthrough(),
  alwaysNeedsHumanReview: z.boolean(),
  rejectIfDuplicate: z.boolean().optional(),
}).passthrough();

export const NamespaceProfilePrivacyRuleSchema = z.object({
  id: z.string().min(1).max(120),
  action: z.enum(['redact', 'quarantine', 'reject']),
  pattern: z.string().min(1).max(2000),
  flags: z.string().max(16).optional(),
  replacement: z.string().max(500).optional(),
  label: z.string().max(120).optional(),
}).passthrough();

export const NamespaceProfilePrivacySchema = z.object({
  enabled: z.boolean(),
  rules: z.array(NamespaceProfilePrivacyRuleSchema),
  logRedactionSummary: z.boolean(),
}).passthrough();

export const NamespaceProfileQualitySchema = z.object({
  enabled: z.boolean(),
  minScore: z.number().min(0).max(1),
  autoRejectBelowMin: z.boolean(),
  ruleBased: z.object({
    enabled: z.boolean(),
    weights: z.record(z.string(), z.number()),
    requiredPatterns: z.array(z.string()).optional(),
    bannedPatterns: z.array(z.string()).optional(),
  }).passthrough(),
  llmJudge: z.object({
    enabled: z.boolean(),
    model: z.string().min(1).max(255),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().positive(),
    promptSystemConfigKey: z.string().min(1).max(128),
    schemaVersion: z.string().min(1).max(64),
  }).passthrough(),
}).passthrough();

export const NamespaceProfileDedupeSchema = z.object({
  scope: z.enum(['tenant', 'namespace']),
  similarityThreshold: z.number().min(0).max(1),
}).passthrough();

export const NamespaceProfileHistorySchema = z.object({
  relevanceThreshold: z.number().min(0).max(1),
  alwaysIncludeCount: z.number().int().nonnegative(),
  minMessages: z.number().int().nonnegative(),
  fallbackEnabled: z.boolean(),
  searchLimit: z.number().int().positive(),
  searchTokenBudget: z.number().int().positive(),
  searchConversationsLimit: z.number().int().positive(),
}).passthrough();

export const NamespaceProfileSlaSchema = z.object({
  syncSeconds: z.number().int().positive(),
  streamSeconds: z.number().int().positive(),
  websocketSeconds: z.number().int().positive(),
  websocketMediaSeconds: z.number().int().positive(),
  externalSeconds: z.number().int().positive(),
  titleSeconds: z.number().int().positive(),
}).passthrough();

export const NamespaceProfileRoutingSchema = z.object({
  threshold: z.number().min(0).max(1),
  gpuPriority: z.enum(['high', 'medium', 'low']),
  promptTokenBudget: z.number().int().positive(),
}).passthrough();

export const NamespaceProfileLlmGovernanceSchema = z.object({
  promptTemplateId: z.string().uuid().optional(),
  promptVersion: z.number().int().positive().optional(),
  toolPolicyKey: z.string().min(1).max(120).optional(),
  toolPolicyVersion: z.number().int().positive().optional(),
}).passthrough();

export const NamespaceProfileConfigSchema = z.object({
  autoCollect: NamespaceProfileAutoCollectSchema,
  privacy: NamespaceProfilePrivacySchema,
  quality: NamespaceProfileQualitySchema,
  dedupe: NamespaceProfileDedupeSchema,
  history: NamespaceProfileHistorySchema,
  sla: NamespaceProfileSlaSchema,
  routing: NamespaceProfileRoutingSchema,
  llmGovernance: NamespaceProfileLlmGovernanceSchema.optional(),
}).passthrough();

export type NamespaceProfileConfig = z.infer<typeof NamespaceProfileConfigSchema>;

// --- Métricas de Agente ---
export const AgentMetricasSchema = z.object({
  totalConversations: z.number().int().nonnegative().optional(),
  totalMessages: z.number().int().nonnegative().optional(),
  avgResponseTime: z.number().nonnegative().optional(),
  avgTokensPerResponse: z.number().nonnegative().optional(),
  satisfactionScore: z.number().min(0).max(5).optional(),
  lastUsed: z.string().datetime().optional(),
}).passthrough();
export type AgentMetricas = z.infer<typeof AgentMetricasSchema>;

// --- Configuração Avançada LLM ---
export const LlmConfigAvancadaSchema = z.object({
  repetitionPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  stopSequences: z.array(z.string()).optional(),
  seed: z.number().int().optional(),
  contextWindow: z.number().int().positive().optional(),
}).passthrough();
export type LlmConfigAvancada = z.infer<typeof LlmConfigAvancadaSchema>;

// --- Metadata Genérico (usado em várias tabelas) ---
export const GenericMetadataSchema = z.record(z.string(), z.unknown()).optional();
export type GenericMetadata = z.infer<typeof GenericMetadataSchema>;

// --- Anexo de Mensagem ---
// ATUALIZADO 23/12/2025: Removido 'video' (muito pesado para GPU)
export const MessageAnexoSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["image", "audio", "document", "file"]),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  url: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  // Gate 2: campos opcionais para auditoria do Vision (OpenAI) quando aplicável
  visionDescription: z.string().max(20000).optional(),
  visionModel: z.string().max(200).optional(),
});
export const MessageAnexosSchema = z.array(MessageAnexoSchema);
export type MessageAnexo = z.infer<typeof MessageAnexoSchema>;
export type MessageAnexos = z.infer<typeof MessageAnexosSchema>;

// --- Metadata de Mensagem ---
export const MessageMetadataSchema = z.object({
  model: z.string().optional(),
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  finishReason: z.enum(["stop", "length", "content_filter", "tool_calls"]).optional(),
  ragContext: z.array(z.object({
    documentId: z.string().uuid(),
    chunkId: z.string().uuid().optional(),
    score: z.number(),
    snippet: z.string(),
  })).optional(),
  generatedImages: z.array(z.string().uuid()).optional(),
}).passthrough();
export type MessageMetadata = z.infer<typeof MessageMetadataSchema>;

// --- Metadata de Conversa ---
export const ConversationMetadataSchema = z.object({
  source: z.enum(["web", "whatsapp", "api", "telegram"]).optional(),
  externalId: z.string().optional(),
  customerInfo: z.object({
    name: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
  }).optional(),
  tags: z.array(z.string()).optional(),
}).passthrough();
export type ConversationMetadata = z.infer<typeof ConversationMetadataSchema>;

// --- Payload de Solicitação de Ação (ex: trading, integrações) ---
export const ActionRequestPayloadSchema = z.object({
  action: z.string().optional(),
  summary: z.string().optional(),
  command: z.record(z.string(), z.unknown()).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  task: z.record(z.string(), z.unknown()).optional(),
  sourceMessageId: z.string().uuid().optional(),
}).passthrough();
export type ActionRequestPayload = z.infer<typeof ActionRequestPayloadSchema>;

// --- Payload de Tarefa Agentic (documentos/relatórios/contabilidade/planejamento) ---
export const AgenticTaskPayloadSchema = z.object({
  taskType: z.enum(["document", "report", "accounting", "planning"]).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sourceMessageId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
}).passthrough();
export type AgenticTaskPayload = z.infer<typeof AgenticTaskPayloadSchema>;

// --- Parâmetros de Learning Task ---
export const LearningTaskParametrosSchema = z.object({
  epochs: z.number().int().positive().optional(),
  batchSize: z.number().int().positive().optional(),
  learningRate: z.number().positive().optional(),
  warmupSteps: z.number().int().nonnegative().optional(),
  validationSplit: z.number().min(0).max(1).optional(),
  loraRank: z.number().int().positive().optional(),
  loraAlpha: z.number().positive().optional(),
}).passthrough();
export type LearningTaskParametros = z.infer<typeof LearningTaskParametrosSchema>;

// --- Resultado de Learning Task ---
export const LearningTaskResultadoSchema = z.object({
  loss: z.number().optional(),
  validationLoss: z.number().optional(),
  accuracy: z.number().optional(),
  modelPath: z.string().optional(),
  trainingTimeSeconds: z.number().optional(),
  samplesProcessed: z.number().int().optional(),
}).passthrough();
export type LearningTaskResultado = z.infer<typeof LearningTaskResultadoSchema>;

// --- Configuração de Integração ---
export const IntegrationConfiguracaoSchema = z.object({
  baseUrl: z.string().url().optional(),
  timeout: z.number().int().positive().optional(),
  retries: z.number().int().nonnegative().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  features: z.record(z.string(), z.boolean()).optional(),
}).passthrough();
export type IntegrationConfiguracao = z.infer<typeof IntegrationConfiguracaoSchema>;

// --- Credenciais de Integração (armazenadas criptografadas) ---
export const IntegrationCredenciaisSchema = z.object({
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  token: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
}).passthrough();
export type IntegrationCredenciais = z.infer<typeof IntegrationCredenciaisSchema>;

// --- Detalhes de Audit Log ---
export const AuditLogDetalhesSchema = z.object({
  before: z.record(z.string(), z.unknown()).optional(),
  after: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export type AuditLogDetalhes = z.infer<typeof AuditLogDetalhesSchema>;

// --- Messages de Training Data ---
export const TrainingMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
  timestamp: z.string().datetime().optional(),
});
export const TrainingMessagesSchema = z.array(TrainingMessageSchema);
export type TrainingMessage = z.infer<typeof TrainingMessageSchema>;
export type TrainingMessages = z.infer<typeof TrainingMessagesSchema>;

export const DatasetSplitPolicySchema = z.enum([
  "chat_deterministic_hash",
  "trading_temporal",
  "trading_purged",
  "walk_forward",
  "mixed_hybrid",
]);
export type DatasetSplitPolicy = z.infer<typeof DatasetSplitPolicySchema>;

export const TrainingDatasetManifestSchema = z.object({
  version: z.literal(1),
  createdAt: z.string().datetime(),
  seed: z.string().min(1),
  splitPolicy: DatasetSplitPolicySchema,
  scope: z.object({
    tenantId: z.string().uuid(),
    namespaceId: z.string().uuid().nullable(),
    agentId: z.string().uuid().nullable(),
  }),
  totals: z.object({
    eligible: z.number().int().nonnegative(),
    train: z.number().int().nonnegative(),
    validation: z.number().int().nonnegative(),
    holdout: z.number().int().nonnegative(),
  }),
  hashes: z.object({
    manifest: z.string().min(1),
    train: z.string().min(1),
    validation: z.string().min(1),
    holdout: z.string().min(1),
  }),
  sourceCounts: z.record(z.string(), z.number().int().nonnegative()),
  rows: z.object({
    train: z.array(z.object({
      id: z.string().uuid(),
      sourceType: z.string().nullable(),
      semhash: z.string().nullable(),
      text: z.string(),
      createdAt: z.string().datetime().nullable(),
    })),
    validation: z.array(z.object({
      id: z.string().uuid(),
      sourceType: z.string().nullable(),
      semhash: z.string().nullable(),
      text: z.string(),
      createdAt: z.string().datetime().nullable(),
    })),
    holdout: z.array(z.object({
      id: z.string().uuid(),
      sourceType: z.string().nullable(),
      semhash: z.string().nullable(),
      text: z.string(),
      createdAt: z.string().datetime().nullable(),
    })),
  }),
}).passthrough();
export type TrainingDatasetManifest = z.infer<typeof TrainingDatasetManifestSchema>;

// --- Hyperparameters de Fine-tuning ---
export const FineTuningHyperparametersSchema = z.object({
  epochs: z.number().int().positive().optional(),
  batchSize: z.number().int().positive().optional(),
  learningRate: z.number().positive().optional(),
  maxSeqLen: z.number().int().min(256).max(32768).optional(),
  gradientAccumulationSteps: z.number().int().min(1).max(128).optional(),
  warmupSteps: z.number().int().min(0).max(10000).optional(),
  warmupRatio: z.number().min(0).max(1).optional(),
  weightDecay: z.number().optional(),
  loraRank: z.number().int().positive().optional(),
  loraAlpha: z.number().positive().optional(),
  loraDropout: z.number().min(0).max(0.5).optional(),
  lrSchedulerType: z.enum([
    'constant',
    'constant_with_warmup',
    'linear',
    'cosine',
    'cosine_with_restarts',
    'polynomial',
    'inverse_sqrt',
    'reduce_lr_on_plateau',
  ]).optional(),
  maxGradNorm: z.number().gt(0).max(100).optional(),
  targetModules: z.array(z.string().min(1)).min(1).optional(),
}).passthrough();
export type FineTuningHyperparameters = z.infer<typeof FineTuningHyperparametersSchema>;

// --- Métricas de Fine-tuning ---
export const FineTuningMetricsSchema = z.object({
  trainLoss: z.number().optional(),
  validationLoss: z.number().optional(),
  trainAccuracy: z.number().optional(),
  validationAccuracy: z.number().optional(),
  epochsCompleted: z.number().int().optional(),
  stepsCompleted: z.number().int().optional(),
  trainingTimeSeconds: z.number().optional(),
}).passthrough();
export type FineTuningMetrics = z.infer<typeof FineTuningMetricsSchema>;

// --- Payload de Webhook ---
export const WebhookPayloadSchema = z.record(z.string(), z.unknown());
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

// --- Detalhes de Trigger de Escalation ---
export const EscalationTriggerDetailsSchema = z.object({
  confidenceScore: z.number().optional(),
  sentimentScore: z.number().optional(),
  fallbackCount: z.number().int().optional(),
  matchedKeywords: z.array(z.string()).optional(),
  slaTimeRemaining: z.number().optional(),
  customerMessage: z.string().optional(),
}).passthrough();
export type EscalationTriggerDetails = z.infer<typeof EscalationTriggerDetailsSchema>;

// --- Métricas de Model Version ---
export const ModelVersionMetricsSchema = z.object({
  accuracy: z.number().optional(),
  f1Score: z.number().optional(),
  perplexity: z.number().optional(),
  avgResponseTime: z.number().optional(),
  humanEvalScore: z.number().optional(),
  samplesEvaluated: z.number().int().optional(),
}).passthrough();
export type ModelVersionMetrics = z.infer<typeof ModelVersionMetricsSchema>;

// --- PII Details para Media ---
export const PiiDetailsSchema = z.object({
  detected: z.boolean(),
  types: z.array(z.enum(["email", "phone", "cpf", "cnpj", "credit_card", "address", "name"])).optional(),
  locations: z.array(z.object({
    type: z.string(),
    start: z.number().int(),
    end: z.number().int(),
  })).optional(),
  redacted: z.boolean().optional(),
}).passthrough();
export type PiiDetails = z.infer<typeof PiiDetailsSchema>;

// --- Content Flags para Media ---
export const ContentFlagsSchema = z.array(z.enum([
  "nsfw",
  "violence",
  "hate_speech",
  "self_harm",
  "dangerous",
  "spam",
  "copyright",
]));
export type ContentFlags = z.infer<typeof ContentFlagsSchema>;

// --- Metadata Extraída de Media (EXIF, etc.) ---
export const ExtractedMetadataSchema = z.object({
  exif: z.record(z.string(), z.unknown()).optional(),
  gps: z.object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }).optional(),
  camera: z.object({
    make: z.string().optional(),
    model: z.string().optional(),
  }).optional(),
  dimensions: z.object({
    width: z.number().int().optional(),
    height: z.number().int().optional(),
  }).optional(),
  colorProfile: z.string().optional(),
  orientation: z.number().int().optional(),
}).passthrough();
export type ExtractedMetadata = z.infer<typeof ExtractedMetadataSchema>;

// --- Session Data (express-session) ---
export const SessionDataSchema = z.object({
  cookie: z.object({
    originalMaxAge: z.number().nullable().optional(),
    expires: z.string().datetime().nullable().optional(),
    secure: z.boolean().optional(),
    httpOnly: z.boolean().optional(),
    path: z.string().optional(),
    sameSite: z.enum(["strict", "lax", "none"]).optional(),
  }).optional(),
  userId: z.string().optional(),
  tenantId: z.string().uuid().optional(),
}).passthrough();
export type SessionData = z.infer<typeof SessionDataSchema>;
