/**
 * Schema Principal (Monolítico) - Alice Enterprise Platform
 * 
 * ⚠️ IMPORTANTE: Este é o ÚNICO schema em uso em produção.
 * 
 * Os arquivos em ./schema/ (rag.ts, chat.ts, etc.) são uma versão MODULAR
 * preparada para migração futura, mas NÃO ESTÃO ATIVOS.
 * 
 * Para modificações no schema:
 * 1. Edite ESTE arquivo (schema.ts)
 * 2. Gere migrations com `pnpm drizzle-kit generate`
 * 3. Os schemas modulares serão sincronizados em migração futura
 * 
 * Multi-tenancy:
 * - agents e conversations possuem tenantId para isolamento
 * - Validação cross-tenant via validateTenantConsistency() de @alice/shared-utils
 * 
 * ARQUITETURA DE EMBEDDINGS (Gate 2 - 15/01/2026):
 * - Texto (Trading/RAG): Qdrant (1024 dim) - Qwen3-Embedding-0.6B
 * - Imagem: OpenAI Vision (descrição textual, sem embeddings de imagem)
 * 
 * NOTA: Campos de embedding de texto neste schema estão DEPRECATED.
 * Novos embeddings de texto são armazenados em Qdrant.
 * Campos mantidos para compatibilidade com dados existentes.
 * 
 * Autor: Fillipe Guerra
 * Data: 16 de Janeiro de 2026
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  numeric,
  customType,
  jsonb,
  index,
  uniqueIndex,
  uuid,
  real,
  pgEnum,
} from "drizzle-orm/pg-core";

// ============================================================================
// PGVECTOR TYPES (Enterprise-Grade) - Arquitetura Unificada (17/12/2025)
// ============================================================================
// 
// TEXTO (Trading/RAG): Qdrant (1024 dim) - Qwen3-Embedding-0.6B
//   - Armazenado em Qdrant (HNSW)
//   - Campos abaixo DEPRECATED - mantidos para compatibilidade
//
// IMAGEM: OpenAI Vision (descrição textual, sem embeddings de imagem)
//
// Referência: https://github.com/pgvector/pgvector
// ============================================================================

// TEXTO: DEPRECATED - Novos embeddings de texto vão para Qdrant (1024 dim)
// Mantido para compatibilidade com dados existentes
// Usar Qdrant para novos embeddings de texto
const textVector = customType<{ data: number[]; driverData: number[] }>({
  dataType() {
    return 'halfvec(3584)'; // DEPRECATED - manter para migração
  },
  // pgvector driver já faz a conversão automaticamente
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// IMAGEM: embeddings de imagem removidos do schema principal
// Mantido apenas como referência histórica do modelo (OpenAI-only para imagens)

// Alias para compatibilidade
// NOTA: Novos embeddings de texto devem ir para Qdrant (1024 dim)
const vector = textVector;

// Training data dedupe pipeline (async worker) usa embeddings de texto 1024 dim.
// Mantido separado do alias legado para evitar alterar outros domínios sem migração explícita.
const trainingVector1024 = customType<{ data: number[]; driverData: number[] }>({
  dataType() {
    return 'halfvec(1024)';
  },
});

// BIOMETRIA: embeddings faciais (face_recognition) usam 128 dimensões
// Deve mapear para vector(128) no PostgreSQL (pgvector)
const biometricsVector128 = customType<{ data: number[]; driverData: number[] }>({
  dataType() {
    return 'vector(128)';
  },
});
import { createInsertSchema } from "drizzle-zod";
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

export const NamespaceProfileConfigSchema = z.object({
  autoCollect: NamespaceProfileAutoCollectSchema,
  privacy: NamespaceProfilePrivacySchema,
  quality: NamespaceProfileQualitySchema,
  dedupe: NamespaceProfileDedupeSchema,
  history: NamespaceProfileHistorySchema,
  sla: NamespaceProfileSlaSchema,
  routing: NamespaceProfileRoutingSchema,
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

// --- Hyperparameters de Fine-tuning ---
export const FineTuningHyperparametersSchema = z.object({
  epochs: z.number().int().positive().optional(),
  batchSize: z.number().int().positive().optional(),
  learningRate: z.number().positive().optional(),
  warmupRatio: z.number().min(0).max(1).optional(),
  weightDecay: z.number().optional(),
  loraRank: z.number().int().positive().optional(),
  loraAlpha: z.number().positive().optional(),
  loraDropout: z.number().min(0).max(1).optional(),
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

// ============================================================================
// ENUMS
// ============================================================================

export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "admin",
  "manager",
  "operator",
  "viewer",
  "guest",
]);

// ATUALIZADO 23/12/2025: Removido 'video' (muito pesado para GPU)
export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "image",
  "audio",
  "document",
  "mixed",
]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "archived",
  "deleted",
]);

export const agentStatusEnum = pgEnum("agent_status", [
  "active",
  "training",
  "paused",
  "deprecated",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

export const backupJobStatusEnum = pgEnum("backup_job_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const webCrawlStatusEnum = pgEnum("web_crawl_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

// Job types de mídia (limpeza 19/12/2025 - removidos obsoletos: tts, talking_head, lip_sync, long_video)
export const mediaJobTypeEnum = pgEnum("media_job_type", [
  "image_enhance",
  "audio_clean",
]);

export const actionRequestTypeEnum = pgEnum("action_request_type", [
  "trading",
  "integration",
  "document",
  "report",
  "accounting",
  "planning",
]);

export const agenticTaskTypeEnum = pgEnum("agentic_task_type", [
  "document",
  "report",
  "accounting",
  "planning",
]);

export const actionRequestStatusEnum = pgEnum("action_request_status", [
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
  "cancelled",
]);

export const biometricsProfileStatusEnum = pgEnum("biometrics_profile_status", [
  "active",
  "disabled",
]);

export const biometricsVerificationStatusEnum = pgEnum("biometrics_verification_status", [
  "success",
  "failed",
]);

export const biometricsActionTypeEnum = pgEnum("biometrics_action_type", [
  "login",
  "approval",
  "enroll",
]);

export const backupTypeEnum = pgEnum("backup_type", [
  "full",
  "incremental",
  "differential",
]);

// ============================================================================
// SESSÕES (PostgreSQL Sessions - OBRIGATÓRIO)
// ============================================================================

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").$type<SessionData>().notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => ({
    idxSessionExpire: index("IDX_session_expire").on(table.expire),
  })
);

// ============================================================================
// EMPRESAS/TENANTS (Multi-tenant Enterprise)
// ============================================================================

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: varchar("nome", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  dominio: varchar("dominio", { length: 255 }),
  logoUrl: text("logo_url"),
  plano: varchar("plano", { length: 50 }).notNull().default("starter"),
  limiteUsuarios: integer("limite_usuarios").default(10),
  limiteConversas: integer("limite_conversas").default(1000),
  limiteArmazenamento: integer("limite_armazenamento_gb").default(10),
  configuracoes: jsonb("configuracoes").$type<TenantConfiguracoes>().default({}),
  ativo: boolean("ativo").default(true),
  criadoEm: timestamp("criado_em").defaultNow(),
  atualizadoEm: timestamp("atualizado_em").defaultNow(),
});

// ============================================================================
// ROLES CUSTOMIZADAS (Departamentos/Funções)
// ============================================================================

export const customRoles = pgTable(
  "custom_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    nome: varchar("nome", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    descricao: text("descricao"),
    baseRole: userRoleEnum("base_role").default("viewer").notNull(),
    ativo: boolean("ativo").default(true),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxCustomRolesTenant: index("idx_custom_roles_tenant").on(table.tenantId),
    idxCustomRolesBaseRole: index("idx_custom_roles_base_role").on(table.baseRole),
    uniqueCustomRolesTenantSlug: uniqueIndex("uniq_custom_roles_tenant_slug").on(table.tenantId, table.slug),
  })
);

// ============================================================================
// USUÁRIOS (Autenticação Unificada: OAuth + SAML + Local)
// Compatível com: Cursor IDE (DEV) e Hetzner Cloud (PROD)
// ============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    email: varchar("email", { length: 255 }).unique(),
    firstName: varchar("first_name", { length: 100 }),
    lastName: varchar("last_name", { length: 100 }),
    preferredName: varchar("preferred_name", { length: 120 }),
    profileImageUrl: text("profile_image_url"),
    role: userRoleEnum("role").default("viewer"),
    customRoleId: uuid("custom_role_id").references(() => customRoles.id, { onDelete: "set null" }),
    cargo: varchar("cargo", { length: 100 }),
    departamento: varchar("departamento", { length: 100 }),
    telefone: varchar("telefone", { length: 20 }),
    idioma: varchar("idioma", { length: 10 }).default("pt-BR"),
    timezone: varchar("timezone", { length: 50 }).default("America/Sao_Paulo"),
    preferencias: jsonb("preferencias").$type<UserPreferencias>().default({}),
    ultimoAcesso: timestamp("ultimo_acesso"),
    ativo: boolean("ativo").default(true),
    // Autenticação Multi-provedor
    passwordHash: text("password_hash"), // Para autenticação local (email/senha)
    authProvider: varchar("auth_provider", { length: 50 }), // google, github, saml, local
    authProviderId: varchar("auth_provider_id", { length: 255 }), // ID do usuário no provedor
    // IDs OAuth específicos por provedor
    googleId: varchar("google_id", { length: 255 }), // ID do Google OAuth
    githubId: varchar("github_id", { length: 255 }), // ID do GitHub OAuth
    samlNameId: varchar("saml_name_id", { length: 255 }), // NameID do SAML 2.0
    emailVerified: boolean("email_verified").default(false), // Se o email foi verificado
    // Stripe (Blueprint: stripe integration)
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idxUsersTenant: index("idx_users_tenant").on(table.tenantId),
    idxUsersEmail: index("idx_users_email").on(table.email),
    idxUsersRole: index("idx_users_role").on(table.role),
    idxUsersCustomRole: index("idx_users_custom_role").on(table.customRoleId),
    idxUsersAuthProvider: index("idx_users_auth_provider").on(table.authProvider),
    idxUsersGoogleId: index("idx_users_google_id").on(table.googleId),
    idxUsersGithubId: index("idx_users_github_id").on(table.githubId),
    idxUsersSamlNameId: index("idx_users_saml_name_id").on(table.samlNameId),
  })
);

// ============================================================================
// PERMISSÕES (RBAC Enterprise)
// ============================================================================

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  codigo: varchar("codigo", { length: 100 }).notNull().unique(),
  nome: varchar("nome", { length: 255 }).notNull(),
  descricao: text("descricao"),
  modulo: varchar("modulo", { length: 100 }).notNull(),
  criadoEm: timestamp("criado_em").defaultNow(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: userRoleEnum("role").notNull(),
    permissionId: uuid("permission_id")
      .references(() => permissions.id, { onDelete: "cascade" })
      .notNull(),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxRolePermissionsRole: index("idx_role_permissions_role").on(table.role),
    idxRolePermissionsPermission: index("idx_role_permissions_permission").on(table.permissionId),
  })
);

export const customRolePermissions = pgTable(
  "custom_role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customRoleId: uuid("custom_role_id")
      .references(() => customRoles.id, { onDelete: "cascade" })
      .notNull(),
    permissionId: uuid("permission_id")
      .references(() => permissions.id, { onDelete: "cascade" })
      .notNull(),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxCustomRolePermissionsRole: index("idx_custom_role_permissions_role").on(table.customRoleId),
    idxCustomRolePermissionsPermission: index("idx_custom_role_permissions_permission").on(table.permissionId),
    uniqueCustomRolePermission: uniqueIndex("uniq_custom_role_permissions").on(table.customRoleId, table.permissionId),
  })
);

// ============================================================================
// MULTI-ROLES (Cargos) - Usuário pode ter múltiplas roles base
// ============================================================================

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    role: userRoleEnum("role").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    idxUserRolesUser: index("idx_user_roles_user").on(table.userId),
    uniqueUserRole: uniqueIndex("uniq_user_roles_user_role").on(table.userId, table.role),
  })
);

// ============================================================================
// MULTI-ROLES CUSTOM (Cargos customizados)
// ============================================================================

export const userCustomRoles = pgTable(
  "user_custom_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    customRoleId: uuid("custom_role_id").references(() => customRoles.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    idxUserCustomRolesUser: index("idx_user_custom_roles_user").on(table.userId),
    uniqueUserCustomRole: uniqueIndex("uniq_user_custom_roles_user_role").on(table.userId, table.customRoleId),
  })
);

// ============================================================================
// OAUTH CLIENTS (SSO - Alice como OAuth Provider)
// RFC 6749 + OIDC Best Practices 2025
// ============================================================================

export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: varchar("client_id", { length: 255 }).notNull().unique(),
    clientSecret: text("client_secret").notNull(),
    nome: varchar("nome", { length: 255 }).notNull(),
    descricao: text("descricao"),
    redirectUris: text("redirect_uris").array().notNull(),
    scopes: text("scopes").array().default(["openid", "profile", "email"]),
    grantTypes: text("grant_types").array().default(["authorization_code", "refresh_token"]),
    tokenEndpointAuthMethod: varchar("token_endpoint_auth_method", { length: 50 }).default("client_secret_post"),
    accessTokenTtl: integer("access_token_ttl").default(3600),
    refreshTokenTtl: integer("refresh_token_ttl").default(86400),
    autoConsent: boolean("auto_consent").default(true),
    ativo: boolean("ativo").default(true),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxOauthClientsClientId: index("idx_oauth_clients_client_id").on(table.clientId),
  })
);

export const oauthAuthorizationCodes = pgTable(
  "oauth_authorization_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 255 }).notNull().unique(),
    clientId: uuid("client_id").references(() => oauthClients.id, { onDelete: "cascade" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    redirectUri: text("redirect_uri").notNull(),
    scopes: text("scopes").array().notNull(),
    codeChallenge: text("code_challenge"),
    codeChallengeMethod: varchar("code_challenge_method", { length: 10 }),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxOauthCodesCode: index("idx_oauth_codes_code").on(table.code),
    idxOauthCodesExpires: index("idx_oauth_codes_expires").on(table.expiresAt),
  })
);

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accessToken: text("access_token").notNull().unique(),
    refreshToken: text("refresh_token").unique(),
    tokenType: varchar("token_type", { length: 50 }).default("Bearer"),
    clientId: uuid("client_id").references(() => oauthClients.id, { onDelete: "cascade" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    scopes: text("scopes").array().notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    revokedAt: timestamp("revoked_at"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxOauthTokensAccess: index("idx_oauth_tokens_access").on(table.accessToken),
    idxOauthTokensRefresh: index("idx_oauth_tokens_refresh").on(table.refreshToken),
    idxOauthTokensUser: index("idx_oauth_tokens_user").on(table.userId),
    idxOauthTokensExpires: index("idx_oauth_tokens_expires").on(table.accessTokenExpiresAt),
  })
);

// ============================================================================
// OIDC PAYLOADS (node-oidc-provider v9.5.2 - Persistência PostgreSQL)
// Armazena tokens, codes, grants, sessions para OIDC Provider
// Seguindo Regra 6 CLAUDE.md: PROIBIDO in-memory storage
// ============================================================================

export const oidcPayloads = pgTable(
  "oidc_payloads",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    type: varchar("type", { length: 50 }).notNull(),
    payload: jsonb("payload").notNull(),
    grantId: varchar("grant_id", { length: 255 }),
    userCode: varchar("user_code", { length: 255 }),
    uid: varchar("uid", { length: 255 }),
    expiresAt: timestamp("expires_at"),
    consumedAt: timestamp("consumed_at"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxOidcPayloadsType: index("idx_oidc_payloads_type").on(table.type),
    idxOidcPayloadsGrantId: index("idx_oidc_payloads_grant_id").on(table.grantId),
    idxOidcPayloadsUserCode: index("idx_oidc_payloads_user_code").on(table.userCode),
    idxOidcPayloadsUid: index("idx_oidc_payloads_uid").on(table.uid),
    idxOidcPayloadsExpires: index("idx_oidc_payloads_expires").on(table.expiresAt),
  })
);

// ============================================================================
// OIDC JWKS (Persistência de Chaves RS256 - Regra 6 CLAUDE.md)
// Armazena chaves de assinatura JWT para sobreviver reinicializações
// ============================================================================

export const oidcJwks = pgTable(
  "oidc_jwks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kid: varchar("kid", { length: 64 }).notNull().unique(),
    alg: varchar("alg", { length: 16 }).notNull().default("RS256"),
    use: varchar("use", { length: 8 }).notNull().default("sig"),
    privateKey: jsonb("private_key").notNull(),
    publicKey: jsonb("public_key").notNull(),
    ativo: boolean("ativo").default(true),
    rotacionadoEm: timestamp("rotacionado_em"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxOidcJwksKid: index("idx_oidc_jwks_kid").on(table.kid),
    idxOidcJwksAtivo: index("idx_oidc_jwks_ativo").on(table.ativo),
  })
);

// ============================================================================
// MÓDULOS DO SISTEMA (RBAC Granular por Funcionalidade)
// Controle de acesso a funcionalidades específicas independente da role
// ============================================================================

export const systemModules = pgTable(
  "system_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codigo: varchar("codigo", { length: 100 }).notNull().unique(),
    nome: varchar("nome", { length: 255 }).notNull(),
    descricao: text("descricao"),
    icone: varchar("icone", { length: 50 }),
    categoria: varchar("categoria", { length: 100 }).notNull(),
    urlExterna: text("url_externa"),
    ordem: integer("ordem").default(0),
    ativo: boolean("ativo").default(true),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxModulesCodigo: index("idx_modules_codigo").on(table.codigo),
    idxModulesCategoria: index("idx_modules_categoria").on(table.categoria),
  })
);

export const roleModules = pgTable(
  "role_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: userRoleEnum("role").notNull(),
    moduleId: uuid("module_id").references(() => systemModules.id, { onDelete: "cascade" }).notNull(),
    acessoLeitura: boolean("acesso_leitura").default(true),
    acessoEscrita: boolean("acesso_escrita").default(false),
    acessoAdmin: boolean("acesso_admin").default(false),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxRoleModulesRole: index("idx_role_modules_role").on(table.role),
    idxRoleModulesModule: index("idx_role_modules_module").on(table.moduleId),
    uniqueRoleModule: index("unique_role_module").on(table.role, table.moduleId),
  })
);

export const userModules = pgTable(
  "user_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    moduleId: uuid("module_id").references(() => systemModules.id, { onDelete: "cascade" }).notNull(),
    permitido: boolean("permitido").notNull(),
    acessoLeitura: boolean("acesso_leitura").default(true),
    acessoEscrita: boolean("acesso_escrita").default(false),
    acessoAdmin: boolean("acesso_admin").default(false),
    criadoPor: uuid("criado_por").references(() => users.id),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxUserModulesUser: index("idx_user_modules_user").on(table.userId),
    idxUserModulesModule: index("idx_user_modules_module").on(table.moduleId),
    uniqueUserModule: index("unique_user_module").on(table.userId, table.moduleId),
  })
);

// ============================================================================
// GRUPOS ORGANIZACIONAIS (sem impacto em permissões)
// ============================================================================

export const userGroups = pgTable(
  "user_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    nome: varchar("nome", { length: 255 }).notNull(),
    descricao: text("descricao"),
    ativo: boolean("ativo").default(true),
    criadoPor: uuid("criado_por").references(() => users.id),
    atualizadoPor: uuid("atualizado_por").references(() => users.id),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxUserGroupsTenant: index("idx_user_groups_tenant").on(table.tenantId),
    idxUserGroupsNome: index("idx_user_groups_nome").on(table.nome),
    uniqueUserGroupTenantName: uniqueIndex("uniq_user_groups_tenant_nome").on(table.tenantId, table.nome),
  })
);

export const userGroupMembers = pgTable(
  "user_group_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    groupId: uuid("group_id").references(() => userGroups.id, { onDelete: "cascade" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    criadoPor: uuid("criado_por").references(() => users.id),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxUserGroupMembersTenant: index("idx_user_group_members_tenant").on(table.tenantId),
    idxUserGroupMembersUser: index("idx_user_group_members_user").on(table.userId),
    idxUserGroupMembersGroup: index("idx_user_group_members_group").on(table.groupId),
    uniqueUserGroupMember: uniqueIndex("uniq_user_group_members_group_user").on(table.groupId, table.userId),
  })
);

// ============================================================================
// NAMESPACES (Contextos de Negócio Verticalizados)
// ============================================================================

export const namespaces = pgTable(
  "namespaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    nome: varchar("nome", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    descricao: text("descricao"),
    icone: varchar("icone", { length: 50 }),
    cor: varchar("cor", { length: 7 }),
    contextoSistema: text("contexto_sistema"),
    configuracoes: jsonb("configuracoes").$type<NamespaceConfiguracoes>().default({}),
    ordem: integer("ordem").default(0),
    ativo: boolean("ativo").default(true),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxNamespacesTenant: index("idx_namespaces_tenant").on(table.tenantId),
    idxNamespacesSlug: index("idx_namespaces_slug").on(table.slug),
  })
);

// ============================================================================
// AGENTES (Agentes de IA Especializados)
// ============================================================================

/**
 * Tabela de Agentes IA
 * 
 * SEGURANÇA MULTI-TENANT:
 * - tenantId DEVE ser igual ao tenantId do namespace referenciado
 * - Validação obrigatória na camada de aplicação antes de INSERT/UPDATE
 * - Use validateTenantConsistency() de @alice/shared-utils antes de criar/atualizar
 * - PostgreSQL RLS policies também aplicam filtro por tenant em runtime
 */
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // tenantId nullable para compatibilidade com migração de dados existentes
    // Validação obrigatória na camada de aplicação via validateTenantConsistency()
    tenantId: uuid("tenant_id").references(() => tenants.id),
    namespaceId: uuid("namespace_id").references(() => namespaces.id, {
      onDelete: "cascade",
    }),
    nome: varchar("nome", { length: 255 }).notNull(),
    preferredName: varchar("preferred_name", { length: 120 }),
    slug: varchar("slug", { length: 100 }).notNull(),
    descricao: text("descricao"),
    avatar: text("avatar"),
    personalidade: text("personalidade"),
    instrucoes: text("instrucoes"),
    capacidades: text("capacidades").array(),
    // Gate 2: modelo base do agente (LLM texto) deve refletir o runtime padrão (Qwen2.5)
    // (mantemos compatibilidade com modelos legados via mapping no chat-service).
    modeloBase: varchar("modelo_base", { length: 100 }).default("Qwen2.5-7B-Instruct-AWQ"),
    temperaturaModelo: real("temperatura_modelo").default(0.7),
    // Gate 2: coerente com max-model-len padrão do stack (2048)
    maxTokens: integer("max_tokens").default(2048),
    status: agentStatusEnum("status").default("active"),
    metricas: jsonb("metricas").$type<AgentMetricas>().default({}),
    versao: integer("versao").default(1),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxAgentsTenant: index("idx_agents_tenant").on(table.tenantId),
    idxAgentsNamespace: index("idx_agents_namespace").on(table.namespaceId),
    idxAgentsStatus: index("idx_agents_status").on(table.status),
  })
);

// ============================================================================
// LLM FALLBACK LOGS (Registro de chamadas que usaram modelo geral)
// Plano Enterprise - Agentes Especializados por Namespace
// ============================================================================

export const llmFallbackLogs = pgTable(
  "llm_fallback_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    userId: uuid("user_id").references(() => users.id),
    rota: varchar("rota", { length: 255 }).notNull(),
    contextoInferido: varchar("contexto_inferido", { length: 100 }),
    serviceOrigem: varchar("service_origem", { length: 100 }),
    chamada: varchar("chamada", { length: 120 }),
    motivoFallback: varchar("motivo_fallback", { length: 120 }),
    namespaceId: uuid("namespace_id").references(() => namespaces.id),
    agentId: uuid("agent_id").references(() => agents.id),
    modeloBase: varchar("modelo_base", { length: 255 }),
    modeloResolvido: varchar("modelo_resolvido", { length: 255 }),
    adapterEncontrado: boolean("adapter_encontrado").default(false).notNull(),
    mensagemPreview: text("mensagem_preview"),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
  },
  (table) => ({
    idxLlmFallbackLogsTenant: index("idx_llm_fallback_logs_tenant").on(table.tenantId),
    idxLlmFallbackLogsTimestamp: index("idx_llm_fallback_logs_timestamp").on(table.criadoEm),
    idxLlmFallbackLogsContexto: index("idx_llm_fallback_logs_contexto").on(table.contextoInferido),
    idxLlmFallbackLogsMotivo: index("idx_llm_fallback_logs_motivo").on(table.motivoFallback),
  })
);

// ============================================================================
// CONVERSAS
// ============================================================================

/**
 * Tabela de Conversas
 * 
 * SEGURANÇA MULTI-TENANT:
 * - tenantId DEVE ser igual ao tenantId do agent e namespace referenciados
 * - Validação obrigatória na camada de aplicação antes de INSERT/UPDATE
 * - Use validateTenantConsistency() de @alice/shared-utils antes de criar/atualizar
 * - PostgreSQL RLS policies também aplicam filtro por tenant em runtime
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // tenantId nullable para compatibilidade com migração de dados existentes
    // Validação obrigatória na camada de aplicação via validateTenantConsistency()
    tenantId: uuid("tenant_id").references(() => tenants.id),
    userId: uuid("user_id").references(() => users.id),
    agentId: uuid("agent_id").references(() => agents.id),
    namespaceId: uuid("namespace_id").references(() => namespaces.id),
    titulo: varchar("titulo", { length: 500 }),
    resumo: text("resumo"),
    status: conversationStatusEnum("status").default("active"),
    isPublic: boolean("is_public").default(false),
    metadata: jsonb("metadata").$type<ConversationMetadata>().default({}),
    totalMensagens: integer("total_mensagens").default(0),
    ultimaMensagemEm: timestamp("ultima_mensagem_em"),
    /** Preenchido quando a conversa foi enviada para Training (evita envio duplo). */
    sentToTrainingAt: timestamp("sent_to_training_at"),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxConversationsTenant: index("idx_conversations_tenant").on(table.tenantId),
    idxConversationsUser: index("idx_conversations_user").on(table.userId),
    idxConversationsAgent: index("idx_conversations_agent").on(table.agentId),
    idxConversationsNamespace: index("idx_conversations_namespace").on(table.namespaceId),
    idxConversationsStatus: index("idx_conversations_status").on(table.status),
  })
);

// ============================================================================
// MENSAGENS (Multimodal: texto, imagem, áudio, vídeo)
// ============================================================================

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id").references(() => users.id),
    agentId: uuid("agent_id").references(() => agents.id),
    tipo: messageTypeEnum("tipo").default("text"),
    conteudo: text("conteudo"),
    anexos: jsonb("anexos").$type<MessageAnexos>().default([]),
    metadata: jsonb("metadata").$type<MessageMetadata>().default({}),
    tokensUsados: integer("tokens_usados"),
    latenciaMs: integer("latencia_ms"),
    isFromUser: boolean("is_from_user").default(true),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxMessagesConversation: index("idx_messages_conversation").on(table.conversationId),
    idxMessagesUser: index("idx_messages_user").on(table.userId),
    idxMessagesCreated: index("idx_messages_created").on(table.criadoEm),
  })
);

// ============================================================================
// ACTION REQUESTS (Confirmação de ações críticas - ex: trading)
// ============================================================================

export const actionRequests = pgTable(
  "action_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    agentId: uuid("agent_id").references(() => agents.id),
    type: actionRequestTypeEnum("type").notNull(),
    status: actionRequestStatusEnum("status").notNull().default("pending"),
    payload: jsonb("payload").$type<ActionRequestPayload>().default({}),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolutionNote: text("resolution_note"),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
    resolvidoEm: timestamp("resolvido_em"),
  },
  (table) => ({
    idxActionRequestsTenant: index("idx_action_requests_tenant").on(table.tenantId),
    idxActionRequestsConversation: index("idx_action_requests_conversation").on(table.conversationId),
    idxActionRequestsStatus: index("idx_action_requests_status").on(table.tenantId, table.status, table.criadoEm),
  })
);

// ============================================================================
// BIOMETRIA FACIAL (CPU-only, sem liveness)
// ============================================================================

export const biometricProfiles = pgTable(
  "biometric_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    userId: uuid("user_id").references(() => users.id).notNull(),
    status: biometricsProfileStatusEnum("status").notNull().default("active"),
    metadata: jsonb("metadata").$type<GenericMetadata>().default({}),
    lastVerifiedAt: timestamp("last_verified_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idxBiometricProfilesTenant: index("idx_biometric_profiles_tenant").on(table.tenantId),
    idxBiometricProfilesUser: index("idx_biometric_profiles_user").on(table.userId),
  })
);

export const biometricEmbeddings = pgTable(
  "biometric_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id").references(() => biometricProfiles.id, { onDelete: "cascade" }).notNull(),
    embedding: biometricsVector128("embedding").notNull(),
    embeddingEncrypted: bytea("embedding_encrypted").notNull(),
    embeddingHash: varchar("embedding_hash", { length: 64 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    idxBiometricEmbeddingsProfile: index("idx_biometric_embeddings_profile").on(table.profileId, table.isActive),
  })
);

export const biometricVerifications = pgTable(
  "biometric_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id").references(() => biometricProfiles.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    userId: uuid("user_id").references(() => users.id).notNull(),
    actionType: biometricsActionTypeEnum("action_type").notNull(),
    status: biometricsVerificationStatusEnum("status").notNull(),
    score: real("score"),
    threshold: real("threshold"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    context: jsonb("context").$type<GenericMetadata>().default({}),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    idxBiometricVerificationsTenant: index("idx_biometric_verifications_tenant").on(table.tenantId, table.createdAt),
    idxBiometricVerificationsUser: index("idx_biometric_verifications_user").on(table.userId, table.createdAt),
  })
);

// ============================================================================
// TAREFAS AGENTIC (Documentos/Relatórios/Contabilidade/Planejamento)
// ============================================================================

export const agenticTasks = pgTable(
  "agentic_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    actionRequestId: uuid("action_request_id").references(() => actionRequests.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id),
    agentId: uuid("agent_id").references(() => agents.id),
    type: agenticTaskTypeEnum("type").notNull(),
    status: taskStatusEnum("status").notNull().default("pending"),
    payload: jsonb("payload").$type<AgenticTaskPayload>().default({}),
    result: jsonb("result").$type<GenericMetadata>(),
    error: text("error"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idxAgenticTasksTenant: index("idx_agentic_tasks_tenant").on(table.tenantId),
    idxAgenticTasksStatus: index("idx_agentic_tasks_status").on(table.tenantId, table.status, table.createdAt),
    idxAgenticTasksType: index("idx_agentic_tasks_type").on(table.tenantId, table.type),
    idxAgenticTasksConversation: index("idx_agentic_tasks_conversation").on(table.conversationId),
    idxAgenticTasksActionRequest: index("idx_agentic_tasks_action_request").on(table.actionRequestId),
  })
);

// ============================================================================
// DOCUMENTOS (Base de Conhecimento para RAG/Trading)
// ARQUITETURA ENTERPRISE (17/12/2025):
// - embedding: DEPRECATED - Novos embeddings de texto vão para Qdrant (1024 dim)
// - Campo mantido para compatibilidade com dados existentes
// ============================================================================

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    namespaceId: uuid("namespace_id").references(() => namespaces.id),
    titulo: varchar("titulo", { length: 500 }).notNull(),
    conteudo: text("conteudo"),
    tipo: varchar("tipo", { length: 50 }),
    fonte: varchar("fonte", { length: 255 }),
    urlOrigem: text("url_origem"),
    arquivoUrl: text("arquivo_url"),
    hashConteudo: varchar("hash_conteudo", { length: 64 }),
    semhash: varchar("semhash", { length: 128 }),
    embedding: vector("embedding"),
    metadata: jsonb("metadata").$type<GenericMetadata>().default({}),
    processado: boolean("processado").default(false),
    /** Preenchido quando o documento foi enviado para Training (evita envio duplo). */
    sentToTrainingAt: timestamp("sent_to_training_at"),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxDocumentsNamespace: index("idx_documents_namespace").on(table.namespaceId),
    idxDocumentsHash: index("idx_documents_hash").on(table.hashConteudo),
    idxDocumentsSemhash: index("idx_documents_semhash").on(table.semhash),
  })
);

// ============================================================================
// CHUNKS DE DOCUMENTOS (Para RAG/Trading)
// ARQUITETURA ENTERPRISE (17/12/2025):
// - embedding: DEPRECATED - Novos embeddings de texto vão para Qdrant (1024 dim)
// ============================================================================

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    conteudo: text("conteudo").notNull(),
    posicao: integer("posicao").notNull(),
    embedding: vector("embedding"),
    metadata: jsonb("metadata").$type<GenericMetadata>().default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxChunksDocument: index("idx_chunks_document").on(table.documentId),
    idxChunksPosition: index("idx_chunks_position").on(table.posicao),
  })
);

// ============================================================================
// TAREFAS DE APRENDIZADO (Fine-tuning, Treinamento)
// ============================================================================

export const learningTasks = pgTable(
  "learning_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    tipo: varchar("tipo", { length: 50 }).notNull(),
    status: taskStatusEnum("status").notNull().default("pending"),
    prioridade: integer("prioridade").notNull().default(5), // 1 (alta) a 10 (baixa)
    agentId: uuid("agent_id").references(() => agents.id),
    namespaceId: uuid("namespace_id").references(() => namespaces.id),
    parametros: jsonb("parametros").$type<LearningTaskParametros>().default({}),
    resultado: jsonb("resultado").$type<LearningTaskResultado>(),
    erro: text("erro"),
    progresso: integer("progresso").default(0),
    tentativas: integer("tentativas").notNull().default(0),
    maxTentativas: integer("max_tentativas").notNull().default(3),
    agendadoPara: timestamp("agendado_para"),
    iniciadoEm: timestamp("iniciado_em"),
    finalizadoEm: timestamp("finalizado_em"),
    criadoEm: timestamp("criado_em").defaultNow(),
    criadoPor: uuid("criado_por").references(() => users.id),
  },
  (table) => ({
    idxLearningTasksStatus: index("idx_learning_tasks_status").on(table.tenantId, table.status),
    idxLearningTasksAgent: index("idx_learning_tasks_agent").on(table.tenantId, table.agentId),
    idxLearningTasksPriority: index("idx_learning_tasks_priority").on(table.tenantId, table.status, table.prioridade, table.agendadoPara, table.criadoEm),
  })
);

// ============================================================================
// EVENTOS DE TAREFAS DE APRENDIZADO (Log estruturado)
// ============================================================================

export const learningTaskEvents = pgTable(
  "learning_task_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    learningTaskId: uuid("learning_task_id")
      .references(() => learningTasks.id, { onDelete: "cascade" })
      .notNull(),
    status: taskStatusEnum("status").notNull(),
    mensagem: text("mensagem"),
    payload: jsonb("payload").$type<GenericMetadata>().default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxLearningTaskEventsTask: index("idx_learning_task_events_task").on(table.learningTaskId),
    idxLearningTaskEventsTenantStatus: index("idx_learning_task_events_tenant_status").on(table.tenantId, table.status, table.criadoEm),
  })
);

// ============================================================================
// WEB CRAWLER REQUESTS (Fila priorizada de crawling)
// ============================================================================

export const webCrawlRequests = pgTable(
  "web_crawl_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    url: text("url").notNull(),
    status: webCrawlStatusEnum("status").notNull().default("pending"),
    profundidadeMax: integer("profundidade_max").notNull().default(1),
    paginasMax: integer("paginas_max").notNull().default(5),
    bytesMax: integer("bytes_max").notNull().default(5_000_000),
    timeoutMs: integer("timeout_ms").notNull().default(15000),
    prioridade: integer("prioridade").notNull().default(5),
    agendadoPara: timestamp("agendado_para"),
    iniciadoEm: timestamp("iniciado_em"),
    finalizadoEm: timestamp("finalizado_em"),
    erro: text("erro"),
    criadoPor: uuid("criado_por").references(() => users.id),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxWebCrawlTenantStatus: index("idx_web_crawl_tenant_status").on(table.tenantId, table.status, table.prioridade, table.agendadoPara, table.criadoEm),
    idxWebCrawlUrl: index("idx_web_crawl_url").on(table.url),
  })
);

// ============================================================================
// WEB CRAWLER RESULTS (Resultados normalizados)
// ============================================================================

export const webCrawlResults = pgTable(
  "web_crawl_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    requestId: uuid("request_id")
      .references(() => webCrawlRequests.id, { onDelete: "cascade" })
      .notNull(),
    url: text("url").notNull(),
    titulo: text("titulo"),
    conteudo: text("conteudo"),
    statusCode: integer("status_code"),
    mimeType: varchar("mime_type", { length: 200 }),
    tamanhoBytes: integer("tamanho_bytes"),
    hashConteudo: varchar("hash_conteudo", { length: 128 }),
    metadata: jsonb("metadata").$type<GenericMetadata>().default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxWebCrawlResultsTenant: index("idx_web_crawl_results_tenant").on(table.tenantId, table.requestId),
    idxWebCrawlResultsUrl: index("idx_web_crawl_results_url").on(table.url),
  })
);

// ============================================================================
// MEDIA JOBS (Pipeline multimodal pesado - GPU Manager Service / CPU local)
// ============================================================================

export const mediaJobs = pgTable(
  "media_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    jobType: mediaJobTypeEnum("job_type").notNull(),
    status: taskStatusEnum("status").default("pending"),
    prioridade: integer("prioridade").notNull().default(5),
    inputUrl: text("input_url"),
    inputPath: text("input_path"),
    parametros: jsonb("parametros").$type<GenericMetadata>().default({}),
    resultado: jsonb("resultado").$type<GenericMetadata>(),
    erro: text("erro"),
    tentativas: integer("tentativas").notNull().default(0),
    maxTentativas: integer("max_tentativas").notNull().default(3),
    agendadoPara: timestamp("agendado_para"),
    iniciadoEm: timestamp("iniciado_em"),
    finalizadoEm: timestamp("finalizado_em"),
    criadoPor: uuid("criado_por").references(() => users.id),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxMediaJobsTenantStatus: index("idx_media_jobs_tenant_status").on(table.tenantId, table.status, table.prioridade, table.agendadoPara, table.criadoEm),
    idxMediaJobsType: index("idx_media_jobs_type").on(table.jobType),
  })
);

// ============================================================================
// INTEGRAÇÕES EXTERNAS (Stripe, Twilio e outros serviços)
// ============================================================================

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    tipo: varchar("tipo", { length: 50 }).notNull(),
    nome: varchar("nome", { length: 255 }).notNull(),
    configuracao: jsonb("configuracao").$type<IntegrationConfiguracao>().default({}),
    credenciais: jsonb("credenciais").$type<IntegrationCredenciais>().default({}),
    webhookUrl: text("webhook_url"),
    ultimaSincronizacao: timestamp("ultima_sincronizacao"),
    ativo: boolean("ativo").default(true),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxIntegrationsTenant: index("idx_integrations_tenant").on(table.tenantId),
    idxIntegrationsTipo: index("idx_integrations_tipo").on(table.tipo),
  })
);

// ============================================================================
// WISE (Sandbox/Produção) - Catálogo Completo
// ============================================================================

export const wiseTokens = pgTable(
  "wise_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    userId: uuid("user_id").references(() => users.id),
    wiseUserId: integer("wise_user_id"),
    tokenType: varchar("token_type", { length: 50 }).notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    scope: text("scope"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idxWiseTokensTenant: index("idx_wise_tokens_tenant").on(table.tenantId),
    idxWiseTokensUser: index("idx_wise_tokens_user").on(table.userId),
    idxWiseTokensType: index("idx_wise_tokens_type").on(table.tokenType),
    uniqWiseTokensTenantTypeUser: uniqueIndex("uniq_wise_tokens_tenant_type_user").on(
      table.tenantId,
      table.tokenType,
      table.userId
    ),
  })
);

export const wiseUsers = pgTable(
  "wise_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseUserId: integer("wise_user_id").notNull(),
    email: varchar("email", { length: 255 }),
    name: varchar("name", { length: 255 }),
    active: boolean("active").default(true),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idxWiseUsersTenant: index("idx_wise_users_tenant").on(table.tenantId),
    uniqWiseUsersTenantWiseId: uniqueIndex("uniq_wise_users_tenant_wise_id").on(
      table.tenantId,
      table.wiseUserId
    ),
  })
);

export const wiseProfiles = pgTable(
  "wise_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseProfileId: integer("wise_profile_id").notNull(),
    type: varchar("type", { length: 40 }),
    details: jsonb("details").$type<GenericMetadata>().default({}),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idxWiseProfilesTenant: index("idx_wise_profiles_tenant").on(table.tenantId),
    uniqWiseProfilesTenantWiseId: uniqueIndex("uniq_wise_profiles_tenant_wise_id").on(
      table.tenantId,
      table.wiseProfileId
    ),
  })
);

export const wiseBalances = pgTable(
  "wise_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseBalanceId: integer("wise_balance_id").notNull(),
    wiseProfileId: integer("wise_profile_id"),
    currency: varchar("currency", { length: 10 }).notNull(),
    type: varchar("type", { length: 30 }),
    name: varchar("name", { length: 255 }),
    amount: jsonb("amount").$type<GenericMetadata>(),
    reservedAmount: jsonb("reserved_amount").$type<GenericMetadata>(),
    totalWorth: jsonb("total_worth").$type<GenericMetadata>(),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idxWiseBalancesTenant: index("idx_wise_balances_tenant").on(table.tenantId),
    idxWiseBalancesCurrency: index("idx_wise_balances_currency").on(table.currency),
    uniqWiseBalancesTenantWiseId: uniqueIndex("uniq_wise_balances_tenant_wise_id").on(
      table.tenantId,
      table.wiseBalanceId
    ),
  })
);

export const wiseRecipients = pgTable(
  "wise_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseRecipientId: integer("wise_recipient_id").notNull(),
    wiseProfileId: integer("wise_profile_id"),
    accountHolderName: varchar("account_holder_name", { length: 255 }),
    currency: varchar("currency", { length: 10 }),
    type: varchar("type", { length: 50 }),
    active: boolean("active").default(true),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idxWiseRecipientsTenant: index("idx_wise_recipients_tenant").on(table.tenantId),
    uniqWiseRecipientsTenantWiseId: uniqueIndex("uniq_wise_recipients_tenant_wise_id").on(
      table.tenantId,
      table.wiseRecipientId
    ),
  })
);

export const wiseQuotes = pgTable(
  "wise_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseQuoteId: varchar("wise_quote_id", { length: 100 }).notNull(),
    sourceCurrency: varchar("source_currency", { length: 10 }),
    targetCurrency: varchar("target_currency", { length: 10 }),
    sourceAmount: real("source_amount"),
    targetAmount: real("target_amount"),
    rate: real("rate"),
    fee: real("fee"),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    idxWiseQuotesTenant: index("idx_wise_quotes_tenant").on(table.tenantId),
    uniqWiseQuotesTenantWiseId: uniqueIndex("uniq_wise_quotes_tenant_wise_id").on(
      table.tenantId,
      table.wiseQuoteId
    ),
  })
);

export const wiseTransfers = pgTable(
  "wise_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseTransferId: integer("wise_transfer_id").notNull(),
    status: varchar("status", { length: 50 }),
    sourceCurrency: varchar("source_currency", { length: 10 }),
    targetCurrency: varchar("target_currency", { length: 10 }),
    sourceValue: real("source_value"),
    targetValue: real("target_value"),
    customerTransactionId: varchar("customer_transaction_id", { length: 255 }),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idxWiseTransfersTenant: index("idx_wise_transfers_tenant").on(table.tenantId),
    idxWiseTransfersStatus: index("idx_wise_transfers_status").on(table.status),
    uniqWiseTransfersTenantWiseId: uniqueIndex("uniq_wise_transfers_tenant_wise_id").on(
      table.tenantId,
      table.wiseTransferId
    ),
  })
);

export const wiseCards = pgTable(
  "wise_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseCardToken: varchar("wise_card_token", { length: 128 }).notNull(),
    wiseProfileId: integer("wise_profile_id"),
    status: varchar("status", { length: 40 }),
    type: varchar("type", { length: 50 }),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idxWiseCardsTenant: index("idx_wise_cards_tenant").on(table.tenantId),
    uniqWiseCardsTenantToken: uniqueIndex("uniq_wise_cards_tenant_token").on(
      table.tenantId,
      table.wiseCardToken
    ),
  })
);

export const wiseCardOrders = pgTable(
  "wise_card_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseCardOrderId: varchar("wise_card_order_id", { length: 128 }).notNull(),
    status: varchar("status", { length: 40 }),
    type: varchar("type", { length: 50 }),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idxWiseCardOrdersTenant: index("idx_wise_card_orders_tenant").on(table.tenantId),
    uniqWiseCardOrdersTenantId: uniqueIndex("uniq_wise_card_orders_tenant_id").on(
      table.tenantId,
      table.wiseCardOrderId
    ),
  })
);

export const wiseCardTransactions = pgTable(
  "wise_card_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseTransactionId: varchar("wise_transaction_id", { length: 128 }).notNull(),
    wiseCardToken: varchar("wise_card_token", { length: 128 }),
    status: varchar("status", { length: 40 }),
    amount: jsonb("amount").$type<GenericMetadata>(),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    occurredAt: timestamp("occurred_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    idxWiseCardTransactionsTenant: index("idx_wise_card_tx_tenant").on(table.tenantId),
    uniqWiseCardTransactionsTenantId: uniqueIndex("uniq_wise_card_tx_tenant_id").on(
      table.tenantId,
      table.wiseTransactionId
    ),
  })
);

export const wiseSpendControls = pgTable(
  "wise_spend_controls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseRuleId: integer("wise_rule_id").notNull(),
    type: varchar("type", { length: 20 }),
    operation: varchar("operation", { length: 20 }),
    description: varchar("description", { length: 255 }),
    values: jsonb("values").$type<GenericMetadata>(),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    idxWiseSpendControlsTenant: index("idx_wise_spend_controls_tenant").on(table.tenantId),
    uniqWiseSpendControlsTenantId: uniqueIndex("uniq_wise_spend_controls_tenant_id").on(
      table.tenantId,
      table.wiseRuleId
    ),
  })
);

export const wiseSpendLimits = pgTable(
  "wise_spend_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    scope: varchar("scope", { length: 20 }).notNull(),
    wiseProfileId: integer("wise_profile_id"),
    wiseCardToken: varchar("wise_card_token", { length: 128 }),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idxWiseSpendLimitsTenant: index("idx_wise_spend_limits_tenant").on(table.tenantId),
  })
);

export const wiseDisputes = pgTable(
  "wise_disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseDisputeId: varchar("wise_dispute_id", { length: 128 }).notNull(),
    status: varchar("status", { length: 40 }),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idxWiseDisputesTenant: index("idx_wise_disputes_tenant").on(table.tenantId),
    uniqWiseDisputesTenantId: uniqueIndex("uniq_wise_disputes_tenant_id").on(
      table.tenantId,
      table.wiseDisputeId
    ),
  })
);

export const wiseActivities = pgTable(
  "wise_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseActivityId: varchar("wise_activity_id", { length: 128 }),
    resourceType: varchar("resource_type", { length: 50 }),
    status: varchar("status", { length: 40 }),
    occurredAt: timestamp("occurred_at"),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    idxWiseActivitiesTenant: index("idx_wise_activities_tenant").on(table.tenantId),
  })
);

export const wiseKycReviews = pgTable(
  "wise_kyc_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseKycReviewId: varchar("wise_kyc_review_id", { length: 128 }).notNull(),
    status: varchar("status", { length: 40 }),
    linkUrl: text("link_url"),
    requiredBy: timestamp("required_by"),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idxWiseKycReviewsTenant: index("idx_wise_kyc_reviews_tenant").on(table.tenantId),
    uniqWiseKycReviewsTenantId: uniqueIndex("uniq_wise_kyc_reviews_tenant_id").on(
      table.tenantId,
      table.wiseKycReviewId
    ),
  })
);

export const wiseVerificationEvidences = pgTable(
  "wise_verification_evidences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseProfileId: integer("wise_profile_id"),
    evidenceKey: varchar("evidence_key", { length: 120 }),
    status: varchar("status", { length: 40 }),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    idxWiseVerificationTenant: index("idx_wise_verification_tenant").on(table.tenantId),
  })
);

export const wiseWebhookSubscriptions = pgTable(
  "wise_webhook_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
    wiseSubscriptionId: varchar("wise_subscription_id", { length: 128 }).notNull(),
    scopeDomain: varchar("scope_domain", { length: 30 }),
    scopeId: varchar("scope_id", { length: 128 }),
    triggerOn: varchar("trigger_on", { length: 120 }),
    deliveryUrl: text("delivery_url"),
    deliveryVersion: varchar("delivery_version", { length: 20 }),
    data: jsonb("data").$type<GenericMetadata>().default({}),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    idxWiseWebhookSubsTenant: index("idx_wise_webhook_subs_tenant").on(table.tenantId),
    uniqWiseWebhookSubsTenantId: uniqueIndex("uniq_wise_webhook_subs_tenant_id").on(
      table.tenantId,
      table.wiseSubscriptionId
    ),
  })
);

export const wiseWebhookEvents = pgTable(
  "wise_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    deliveryId: varchar("delivery_id", { length: 128 }),
    subscriptionId: varchar("subscription_id", { length: 128 }),
    eventType: varchar("event_type", { length: 120 }),
    schemaVersion: varchar("schema_version", { length: 20 }),
    sentAt: timestamp("sent_at"),
    signatureValid: boolean("signature_valid").default(false),
    payload: jsonb("payload").$type<GenericMetadata>().default({}),
    receivedAt: timestamp("received_at").defaultNow(),
  },
  (table) => ({
    idxWiseWebhookEventsTenant: index("idx_wise_webhook_events_tenant").on(table.tenantId),
    idxWiseWebhookEventsEvent: index("idx_wise_webhook_events_event").on(table.eventType),
  })
);

// ============================================================================
// CONFIGURAÇÕES DO MODELO LLM (Gate 2 - LLM texto + Vision via OpenAI)
// - LLM (texto): Qwen2.5 7B Instruct (AWQ) via GPU Manager Service
// - Vision (análise de imagens): OpenAI Responses API (gpt-4.1)
// ============================================================================

export const llmConfig = pgTable("llm_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  modelo: varchar("modelo", { length: 100 }).notNull().default("Qwen2.5-7B-Instruct-AWQ"),
  endpoint: text("endpoint").notNull(),
  apiKey: text("api_key"),
  maxTokens: integer("max_tokens").default(2048),
  temperatura: real("temperatura").default(0.7),
  topP: real("top_p").default(0.9),
  configuracaoAvancada: jsonb("configuracao_avancada").$type<LlmConfigAvancada>().default({}),
  ativo: boolean("ativo").default(true),
  criadoEm: timestamp("criado_em").defaultNow(),
  atualizadoEm: timestamp("atualizado_em").defaultNow(),
});

// ============================================================================
// AUDITORIA (Enterprise Compliance)
// ============================================================================

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    userId: uuid("user_id").references(() => users.id),
    acao: varchar("acao", { length: 100 }).notNull(),
    recurso: varchar("recurso", { length: 100 }).notNull(),
    recursoId: varchar("recurso_id", { length: 255 }),
    detalhes: jsonb("detalhes").$type<AuditLogDetalhes>().default({}),
    ip: varchar("ip", { length: 45 }),
    userAgent: text("user_agent"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxAuditTenant: index("idx_audit_tenant").on(table.tenantId),
    idxAuditUser: index("idx_audit_user").on(table.userId),
    idxAuditAcao: index("idx_audit_acao").on(table.acao),
    idxAuditCreated: index("idx_audit_created").on(table.criadoEm),
  })
);

// Ledger imutavel para auditoria de eventos de alto risco.
// Encadeia hashes por stream+stream_key para detectar qualquer adulteracao.
export const immutableAuditEvents = pgTable(
  "immutable_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    sourceService: varchar("source_service", { length: 64 }).notNull(),
    stream: varchar("stream", { length: 120 }).notNull(),
    streamKey: varchar("stream_key", { length: 255 }).notNull(),
    chainPosition: integer("chain_position").notNull(),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    resourceType: varchar("resource_type", { length: 120 }).notNull(),
    resourceId: varchar("resource_id", { length: 255 }),
    requestId: varchar("request_id", { length: 128 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    prevEventHash: varchar("prev_event_hash", { length: 64 }),
    eventHash: varchar("event_hash", { length: 64 }).notNull(),
    hashAlgorithm: varchar("hash_algorithm", { length: 16 }).notNull().default("sha256"),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    idxImmutableAuditTenant: index("idx_immutable_audit_tenant").on(table.tenantId),
    idxImmutableAuditStream: index("idx_immutable_audit_stream")
      .on(table.tenantId, table.stream, table.streamKey, table.chainPosition),
    idxImmutableAuditEventType: index("idx_immutable_audit_event_type").on(table.tenantId, table.eventType),
    idxImmutableAuditCreated: index("idx_immutable_audit_created").on(table.createdAt),
    uqImmutableAuditStreamChain: uniqueIndex("uq_immutable_audit_stream_chain")
      .on(table.tenantId, table.stream, table.streamKey, table.chainPosition),
    uqImmutableAuditEventHash: uniqueIndex("uq_immutable_audit_event_hash").on(table.tenantId, table.eventHash),
  })
);

// ============================================================================
// MÉTRICAS DE USO
// ============================================================================

export const usageMetrics = pgTable(
  "usage_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    userId: uuid("user_id").references(() => users.id),
    type: varchar("type", { length: 50 }).notNull().default("message"),
    data: timestamp("data").notNull().defaultNow(),
    totalMensagens: integer("total_mensagens").default(0),
    totalTokens: integer("total_tokens").default(0),
    tokensPrompt: integer("tokens_prompt").default(0),
    tokensCompletion: integer("tokens_completion").default(0),
    totalArquivos: integer("total_arquivos").default(0),
    armazenamentoUsadoMb: integer("armazenamento_usado_mb").default(0),
    responseTime: integer("response_time_ms"),
    model: varchar("model", { length: 100 }),
    error: boolean("error").default(false),
    errorMessage: text("error_message"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxUsageTenant: index("idx_usage_tenant").on(table.tenantId),
    idxUsageUser: index("idx_usage_user").on(table.userId),
    idxUsageData: index("idx_usage_data").on(table.data),
    idxUsageType: index("idx_usage_type").on(table.type),
  })
);

// ============================================================================
// DADOS DE TREINAMENTO (Auto-evolução/Fine-tuning)
// ARQUITETURA ENTERPRISE (17/12/2025):
// - embedding: DEPRECATED - Novos embeddings de texto vão para Qdrant (1024 dim)
// ============================================================================

export const trainingDataStatusEnum = pgEnum("training_data_status", [
  "pending",
  "approved",
  "rejected",
  "used",
]);

export const trainingSourceTypeEnum = pgEnum("training_source_type", [
  "chat",
  "trading_signal",
  "trading_order",
  "trading_demo",
  "trading_postmortem",
  "document",
  "rag_document",
  "rag_media", // Plano RAG Multimodal Fase 4 - mídia (imagem/áudio) promovida para treinamento
  "upload",
  "external",
  "manual",
  "system",
]);

export const trainingScopeTypeEnum = pgEnum("training_scope_type", [
  "namespace",
  "agent",
]);

export const trainingData = pgTable(
  "training_data",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    namespaceId: uuid("namespace_id").references(() => namespaces.id),
    agentId: uuid("agent_id").references(() => agents.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    source: varchar("source", { length: 50 }).notNull(),
    sourceType: trainingSourceTypeEnum("source_type").notNull().default("manual"),
    sourceId: varchar("source_id", { length: 255 }),
    sourceMetadata: jsonb("source_metadata").$type<GenericMetadata>().default({}),
    inferredNamespaceId: uuid("inferred_namespace_id").references(() => namespaces.id),
    inferredAgentId: uuid("inferred_agent_id").references(() => agents.id),
    inferredDomain: varchar("inferred_domain", { length: 120 }),
    inferenceConfidence: real("inference_confidence"),
    inferenceTrace: jsonb("inference_trace").$type<GenericMetadata>().default({}),
    scopeResolverVersion: varchar("scope_resolver_version", { length: 50 }),
    profileVersion: integer("profile_version").default(1),
    needsHumanReview: boolean("needs_human_review").default(false),
    quarantineReason: text("quarantine_reason"),
    scopeResolvedAt: timestamp("scope_resolved_at"),
    quarantinedAt: timestamp("quarantined_at"),
    messages: jsonb("messages").$type<TrainingMessages>().notNull(),
    rating: integer("rating"),
    qualityScore: real("quality_score"),
    status: trainingDataStatusEnum("status").default("pending"),
    createdBy: uuid("created_by").references(() => users.id),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at"),
    reviewNotes: text("review_notes"),
    semhash: varchar("semhash", { length: 64 }),
    embedding: trainingVector1024("embedding"),
    isDuplicate: boolean("is_duplicate").default(false),
    duplicateOfId: uuid("duplicate_of_id"),
    similarityScore: real("similarity_score"),
    usedInJobId: varchar("used_in_job_id", { length: 255 }),
    criadoEm: timestamp("criado_em").defaultNow(),
    processedAt: timestamp("processed_at"),
    processadoEm: timestamp("processado_em"),
  },
  (table) => ({
    idxTrainingTenant: index("idx_training_tenant").on(table.tenantId),
    idxTrainingNamespace: index("idx_training_namespace").on(table.namespaceId),
    idxTrainingAgent: index("idx_training_agent").on(table.agentId),
    idxTrainingStatus: index("idx_training_status").on(table.status),
    idxTrainingNeedsReview: index("idx_training_needs_review").on(table.needsHumanReview),
    idxTrainingInferredNamespace: index("idx_training_inferred_namespace").on(table.inferredNamespaceId),
    idxTrainingInferredAgent: index("idx_training_inferred_agent").on(table.inferredAgentId),
    idxTrainingInferenceConfidence: index("idx_training_inference_confidence").on(table.inferenceConfidence),
    idxTrainingSemhash: index("idx_training_semhash").on(table.semhash),
    trainingDataTenantSemhashIdx: index("training_data_tenant_semhash_idx").on(table.tenantId, table.semhash),
    trainingDataProcessedAtIdx: index("training_data_processed_at_idx").on(table.processedAt),
    idxTrainingSource: index("idx_training_source").on(table.source),
    idxTrainingSourceType: index("idx_training_source_type").on(table.sourceType),
    idxTrainingSourceId: index("idx_training_source_id").on(table.sourceId),
  })
);

export const namespaceProfiles = pgTable(
  "namespace_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    namespaceId: uuid("namespace_id").notNull().references(() => namespaces.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    autoCollectEnabled: boolean("auto_collect_enabled").notNull().default(true),
    config: jsonb("config").$type<NamespaceProfileConfig>().notNull().default({} as NamespaceProfileConfig),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    uniqueNamespaceProfilesTenantNamespace: uniqueIndex("uniq_namespace_profiles_tenant_namespace").on(
      table.tenantId,
      table.namespaceId
    ),
    idxNamespaceProfilesTenant: index("idx_namespace_profiles_tenant").on(table.tenantId),
    idxNamespaceProfilesNamespace: index("idx_namespace_profiles_namespace").on(table.namespaceId),
    idxNamespaceProfilesAutoCollect: index("idx_namespace_profiles_auto_collect").on(table.autoCollectEnabled),
    idxNamespaceProfilesActive: index("idx_namespace_profiles_active").on(table.isActive),
  })
);

export const trainingDatasetProfiles = pgTable(
  "training_dataset_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    namespaceId: uuid("namespace_id").notNull().references(() => namespaces.id),
    agentId: uuid("agent_id").references(() => agents.id),
    domain: varchar("domain", { length: 120 }).notNull(),
    weights: jsonb("weights").$type<GenericMetadata>().default({}),
    keywords: jsonb("keywords").$type<string[]>().default([]),
    exclusions: jsonb("exclusions").$type<string[]>().default([]),
    samplingPolicy: jsonb("sampling_policy").$type<GenericMetadata>().default({}),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxTrainingProfilesTenant: index("idx_training_profiles_tenant").on(table.tenantId),
    idxTrainingProfilesNamespace: index("idx_training_profiles_namespace").on(table.namespaceId),
    idxTrainingProfilesAgent: index("idx_training_profiles_agent").on(table.agentId),
    idxTrainingProfilesDomain: index("idx_training_profiles_domain").on(table.domain),
    idxTrainingProfilesActive: index("idx_training_profiles_active").on(table.isActive),
    idxTrainingProfilesVersion: index("idx_training_profiles_version").on(table.version),
  })
);

export const trainingDatasetVersions = pgTable(
  "training_dataset_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    namespaceId: uuid("namespace_id").references(() => namespaces.id),
    agentId: uuid("agent_id").references(() => agents.id),
    sourceCounts: jsonb("source_counts").$type<Record<string, number>>().notNull().default({}),
    dataWindow: jsonb("data_window").$type<Record<string, unknown>>().notNull().default({}),
    profileId: uuid("profile_id").references(() => trainingDatasetProfiles.id),
    profileVersion: integer("profile_version").notNull().default(1),
    hash: varchar("hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    idxTrainingDatasetVersionsTenant: index("idx_training_dataset_versions_tenant").on(table.tenantId),
    idxTrainingDatasetVersionsNamespace: index("idx_training_dataset_versions_namespace").on(table.namespaceId),
  })
);

export const trainingLineageEvents = pgTable(
  "training_lineage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    namespaceId: uuid("namespace_id").references(() => namespaces.id),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    sourceTable: varchar("source_table", { length: 64 }),
    sourceId: varchar("source_id", { length: 255 }),
    producedTable: varchar("produced_table", { length: 64 }),
    producedId: varchar("produced_id", { length: 255 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    idxTrainingLineageEventsTenant: index("idx_training_lineage_events_tenant").on(table.tenantId),
    idxTrainingLineageEventsEventType: index("idx_training_lineage_events_event_type").on(table.eventType),
  })
);

export const trainingScopeOverrides = pgTable(
  "training_scope_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trainingDataId: uuid("training_data_id").notNull().references(() => trainingData.id),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    oldNamespaceId: uuid("old_namespace_id").references(() => namespaces.id),
    newNamespaceId: uuid("new_namespace_id").references(() => namespaces.id),
    oldDomain: varchar("old_domain", { length: 120 }),
    newDomain: varchar("new_domain", { length: 120 }),
    oldAgentId: uuid("old_agent_id").references(() => agents.id),
    newAgentId: uuid("new_agent_id").references(() => agents.id),
    changedBy: uuid("changed_by").notNull().references(() => users.id),
    reason: text("reason").notNull(),
    source: varchar("source", { length: 50 }).default("manual_review"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    idxTrainingScopeOverridesTrainingData: index("idx_training_scope_overrides_training_data").on(table.trainingDataId),
    idxTrainingScopeOverridesTenant: index("idx_training_scope_overrides_tenant").on(table.tenantId),
    idxTrainingScopeOverridesCreated: index("idx_training_scope_overrides_created").on(table.createdAt),
  })
);

// ============================================================================
// JOBS DE FINE-TUNING
// ============================================================================

export const fineTuningJobStatusEnum = pgEnum("fine_tuning_job_status", [
  "pending",
  "preparing",
  "training",
  "validating",
  "completed",
  "failed",
  "cancelled",
]);

export const fineTuningRunSourceEnum = pgEnum("fine_tuning_run_source", [
  "custom_job",
  "on_demand",
  "scheduled",
]);

export const fineTuningEvaluationStatusEnum = pgEnum("fine_tuning_evaluation_status", [
  "pending",
  "running",
  "passed",
  "failed",
  "skipped",
]);

export const fineTuningPromotionStatusEnum = pgEnum("fine_tuning_promotion_status", [
  "candidate",
  "staged",
  "active",
  "rejected",
  "rolled_back",
]);

export const fineTuningPromotionApprovalDecisionEnum = pgEnum("fine_tuning_promotion_approval_decision", [
  "approved",
  "rejected",
]);

export const fineTuningJobs = pgTable(
  "fine_tuning_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    name: varchar("name", { length: 255 }).notNull(),
    baseModel: varchar("base_model", { length: 100 }).notNull(),
    status: fineTuningJobStatusEnum("status").default("pending"),
    runSource: fineTuningRunSourceEnum("run_source").notNull().default("custom_job"),
    progress: integer("progress").default(0),
    containerGroupId: varchar("container_group_id", { length: 255 }),
    trainingDataCount: integer("training_data_count").default(0),
    validationDataCount: integer("validation_data_count").default(0),
    datasetVersionId: uuid("dataset_version_id").references(() => trainingDatasetVersions.id),
    // FK para lora_jobs/model_versions aplicada via migration SQL para evitar ciclo de tipos no schema TS.
    loraJobId: uuid("lora_job_id"),
    modelVersionId: uuid("model_version_id"),
    scopeNamespaceId: uuid("scope_namespace_id").references(() => namespaces.id),
    scopeAgentId: uuid("scope_agent_id").references(() => agents.id),
    configSnapshot: jsonb("config_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    evaluationStatus: fineTuningEvaluationStatusEnum("evaluation_status").notNull().default("pending"),
    promotionStatus: fineTuningPromotionStatusEnum("promotion_status").notNull().default("candidate"),
    hyperparameters: jsonb("hyperparameters").$type<FineTuningHyperparameters>().default({}),
    metrics: jsonb("metrics").$type<FineTuningMetrics>().default({}),
    resultModel: varchar("result_model", { length: 255 }),
    errorMessage: text("error_message"),
    iniciadoEm: timestamp("iniciado_em"),
    completadoEm: timestamp("completado_em"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxFinetuningTenant: index("idx_finetuning_tenant").on(table.tenantId),
    idxFinetuningStatus: index("idx_finetuning_status").on(table.status),
    idxFinetuningTenantStatusScopeNamespace: index("idx_finetuning_tenant_status_scope_namespace").on(
      table.tenantId,
      table.status,
      table.scopeNamespaceId
    ),
    idxFinetuningTenantStatusScopeAgent: index("idx_finetuning_tenant_status_scope_agent").on(
      table.tenantId,
      table.status,
      table.scopeAgentId
    ),
    idxFinetuningRunSource: index("idx_finetuning_run_source").on(table.runSource),
    idxFinetuningEvaluationStatus: index("idx_finetuning_evaluation_status").on(table.evaluationStatus),
    idxFinetuningPromotionStatus: index("idx_finetuning_promotion_status").on(table.promotionStatus),
    idxFinetuningLoraJob: index("idx_finetuning_lora_job").on(table.loraJobId),
    idxFinetuningModelVersion: index("idx_finetuning_model_version").on(table.modelVersionId),
  })
);

export const fineTuningPromotionApprovals = pgTable(
  "fine_tuning_promotion_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    fineTuningJobId: uuid("fine_tuning_job_id").notNull().references(() => fineTuningJobs.id, {
      onDelete: "cascade",
    }),
    approverUserId: uuid("approver_user_id").notNull().references(() => users.id),
    decision: fineTuningPromotionApprovalDecisionEnum("decision").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    idxFineTuningPromotionApprovalsTenant: index("idx_ft_promotion_approvals_tenant").on(table.tenantId),
    idxFineTuningPromotionApprovalsJob: index("idx_ft_promotion_approvals_job").on(table.fineTuningJobId),
    idxFineTuningPromotionApprovalsDecision: index("idx_ft_promotion_approvals_decision").on(table.decision),
    idxFineTuningPromotionApprovalsUniqueApproverByJob: uniqueIndex("idx_ft_promotion_approvals_unique_job_user")
      .on(table.fineTuningJobId, table.approverUserId),
  })
);

// ============================================================================
// WEBHOOK EVENTS (Idempotência para Stripe/Wise - Segurança Enterprise)
// Previne processamento duplicado de webhooks em caso de retry
// ============================================================================

export const webhookSourceEnum = pgEnum("webhook_source", [
  "stripe",
  "wise",
  "twilio",
]);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    source: webhookSourceEnum("source").notNull(),
    eventId: varchar("event_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 255 }).notNull(),
    processed: boolean("processed").default(false),
    processedAt: timestamp("processed_at"),
    payload: jsonb("payload").$type<WebhookPayload>().default({}),
    result: jsonb("result").$type<WebhookPayload>().default({}),
    error: text("error"),
    retryCount: integer("retry_count").default(0),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxWebhookEventsUnique: index("idx_webhook_events_unique").on(table.source, table.eventId),
    idxWebhookEventsTenant: index("idx_webhook_events_tenant").on(table.tenantId),
    idxWebhookEventsSource: index("idx_webhook_events_source").on(table.source),
    idxWebhookEventsProcessed: index("idx_webhook_events_processed").on(table.processed),
    idxWebhookEventsCreated: index("idx_webhook_events_created").on(table.criadoEm),
  })
);

// ============================================================================
// TRADING - KuCoin Futures BTC Perpetuals (Gate 2)
// Sistema de trading automatizado com OMS/EMS e auditoria completa.
// Exchange: KuCoin Futures (https://www.kucoin.com/futures/trade)
// Par: símbolo do contrato KuCoin (dinâmico, sem hardcoded)
// ============================================================================

// Enums para Trading
export const tradingOrderSideEnum = pgEnum("trading_order_side", [
  "buy",   // Compra (long)
  "sell",  // Venda (short ou fechar posição)
]);

export const tradingOrderTypeEnum = pgEnum("trading_order_type", [
  "limit",       // Ordem limitada
  "market",      // Ordem a mercado
  "stop_limit",  // Stop loss com preço limite
  "stop_market", // Stop loss a mercado
  "take_profit", // Take profit
]);

export const tradingOrderStatusEnum = pgEnum("trading_order_status", [
  "pending",      // Aguardando envio para exchange
  "pending_review", // Aguardando revisão manual antes de enviar para exchange
  "submitted",    // Enviada para exchange
  "open",         // Aberta (parcialmente executada)
  "filled",       // Totalmente executada
  "cancelled",    // Cancelada
  "rejected",     // Rejeitada pela exchange
  "review_rejected", // Rejeitada na revisão manual (antes de envio)
  "expired",      // Expirada
  "error",        // Erro no processamento
]);

export const tradingPositionStatusEnum = pgEnum("trading_position_status", [
  "open",         // Posição aberta
  "closed",       // Posição fechada
  "liquidated",   // Posição liquidada (margin call)
]);

export const tradingSignalTypeEnum = pgEnum("trading_signal_type", [
  "entry_long",   // Entrada long
  "entry_short",  // Entrada short
  "exit",         // Saída da posição
  "adjust_sl",    // Ajustar stop loss
  "adjust_tp",    // Ajustar take profit
  "hold",         // Manter posição
  "neutral",      // Sem sinal (esperar)
]);

// Market type para Trading (Futures/Spot/Margin)
export const tradingMarketTypeEnum = pgEnum("trading_market_type", [
  "futures",
  "spot",
  "margin",
]);

export const tradingMarginModeEnum = pgEnum("trading_margin_mode", [
  "cross",
  "isolated",
]);

// Enum para intervalos de candles
export const tradingIntervalEnum = pgEnum("trading_interval", [
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "8h", "12h",
  "1d", "1w"
]);

// ============================================================================
// PERFIS DE ANÁLISE/SINAIS (Multi-timeframe + Indicadores + Fontes)
// ============================================================================
export const tradingProfileKindEnum = pgEnum("trading_profile_kind", [
  "analysis",
  "signal",
]);

export const tradingTechniqueEnum = pgEnum("trading_technique", [
  "scalping",
  "day_trade",
  "swing",
  "position",
  "trend",
  "mean_reversion",
  "breakout",
  "range",
  "momentum",
  "arbitrage_triangular",
  "cash_and_carry",
  "basis_trade",
  "funding_arbitrage",
  "grid_trading",
  "market_making",
]);

export const TradingIndicatorKeySchema = z.enum([
  "rsi",
  "macd",
  "moving_averages",
  "bollinger",
  "atr",
  "stochastic",
  "adx",
  "support_resistance",
  "volume",
]);
export type TradingIndicatorKey = z.infer<typeof TradingIndicatorKeySchema>;

export const TradingTechniqueSchema = z.enum([
  "scalping",
  "day_trade",
  "swing",
  "position",
  "trend",
  "mean_reversion",
  "breakout",
  "range",
  "momentum",
  "arbitrage_triangular",
  "cash_and_carry",
  "basis_trade",
  "funding_arbitrage",
  "grid_trading",
  "market_making",
]);
export type TradingTechnique = z.infer<typeof TradingTechniqueSchema>;

export const TradingEnsembleModeSchema = z.enum([
  "ensemble_top3",
]);
export type TradingEnsembleMode = z.infer<typeof TradingEnsembleModeSchema>;

export const TradingEnsembleConfigSchema = z.object({
  mode: TradingEnsembleModeSchema.default("ensemble_top3"),
  topN: z.number().int().min(1).max(5).default(3),
});
export type TradingEnsembleConfig = z.infer<typeof TradingEnsembleConfigSchema>;

export const TradingArbitrageExchangeSchema = z.enum([
  "kucoin",
]);
export type TradingArbitrageExchange = z.infer<typeof TradingArbitrageExchangeSchema>;

export const TradingArbitrageConfigSchema = z.object({
  exchanges: z.array(TradingArbitrageExchangeSchema).min(1),
  intermediateAssets: z.array(z.string().min(1)).min(1).max(30),
  feePct: z.number().min(0).max(5),
  maxSlippagePct: z.number().min(0).max(5),
  minEdgePct: z.number().min(0).max(10),
  maxIntervalMinutes: z.number().int().min(1).max(60),
});
export type TradingArbitrageConfig = z.infer<typeof TradingArbitrageConfigSchema>;

export const TradingArbitrageNetworkFeeSchema = z.object({
  asset: z.string().min(1),
  amount: z.number().nonnegative(),
  fromExchange: TradingArbitrageExchangeSchema,
  toExchange: TradingArbitrageExchangeSchema,
});
export type TradingArbitrageNetworkFee = z.infer<typeof TradingArbitrageNetworkFeeSchema>;

export const TradingArbitrageLegSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  symbol: z.string().min(1),
  exchange: TradingArbitrageExchangeSchema,
  side: z.enum(['sell', 'buy']),
  rate: z.number().positive(),
  bestBid: z.number().nullable().optional(),
  bestAsk: z.number().nullable().optional(),
});
export type TradingArbitrageLeg = z.infer<typeof TradingArbitrageLegSchema>;

export const TradingArbitrageSnapshotSchema = z.object({
  intermediateAsset: z.string().min(1),
  startAsset: z.string().min(1),
  endAsset: z.string().min(1),
  edgePct: z.number(),
  finalAmount: z.number(),
  networkFeeTotal: z.number().nonnegative().optional(),
  networkFeesApplied: z.array(TradingArbitrageNetworkFeeSchema).optional(),
  legs: z.array(TradingArbitrageLegSchema).min(1),
});
export type TradingArbitrageSnapshot = z.infer<typeof TradingArbitrageSnapshotSchema>;

export const TradingProfileDataSourcesSchema = z.object({
  orderBook: z.boolean().optional(),
  news: z.boolean().optional(),
  trainingData: z.boolean().optional(),
});
export type TradingProfileDataSources = z.infer<typeof TradingProfileDataSourcesSchema>;

export const TradingProfileModelConfigSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(256).max(4096).optional(),
});
export type TradingProfileModelConfig = z.infer<typeof TradingProfileModelConfigSchema>;

export const TradingProfileNewsConfigSchema = z.object({
  engines: z.array(z.string().min(1)).optional(),
  categories: z.string().min(1).optional(),
  language: z.string().min(2).optional(),
  safesearch: z.string().min(1).optional(),
  timeRange: z.enum(['last_hour', 'last_24_hours', 'custom', 'day', 'week', 'month', 'year']).optional(),
  dateFrom: z.string().min(10).optional(),
  dateTo: z.string().min(10).optional(),
  queryTemplates: z.array(z.string().min(3)).optional(),
  extraTerms: z.array(z.string().min(1)).optional(),
  maxResults: z.number().int().min(1).max(10).optional(),
});
export type TradingProfileNewsConfig = z.infer<typeof TradingProfileNewsConfigSchema>;

// Resumo de notícias usado na análise/sinal (persistido no metadata)
export const TradingNewsSummarySchema = z.object({
  query: z.string().min(1),
  results: z.array(z.object({
    title: z.string().min(1),
    url: z.string().min(1),
    score: z.number().optional(),
  })),
});
export type TradingNewsSummary = z.infer<typeof TradingNewsSummarySchema>;

export const TradingProfileConsensusSchema = z.object({
  rule: z.enum(["majority"]).default("majority"),
  minAgree: z.number().min(1).optional(),
});
export type TradingProfileConsensus = z.infer<typeof TradingProfileConsensusSchema>;

export const TradingOperationTypeSchema = z.enum([
  "scalping",
  "swing",
  "position",
  "cash_and_carry",
  "arbitrage",
  "hedge",
  "neutral",
]);
export type TradingOperationType = z.infer<typeof TradingOperationTypeSchema>;

export const TradingOverallSignalSchema = z.enum([
  "strong_buy",
  "buy",
  "neutral",
  "sell",
  "strong_sell",
]);
export type TradingOverallSignal = z.infer<typeof TradingOverallSignalSchema>;

export const TradingTechniqueScoreSchema = z.object({
  technique: TradingTechniqueSchema,
  signal: TradingOverallSignalSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().optional(),
});
export type TradingTechniqueScore = z.infer<typeof TradingTechniqueScoreSchema>;

export const TradingEnsembleResultSchema = z.object({
  overallSignal: TradingOverallSignalSchema,
  confidence: z.number().min(0).max(1),
  topTechniques: z.array(TradingTechniqueScoreSchema).min(1),
});
export type TradingEnsembleResult = z.infer<typeof TradingEnsembleResultSchema>;

export const TradingSignalValidationSummarySchema = z.object({
  reasonCode: z.enum(['ok', 'no_values', 'discrepancy']).optional(),
  failedFields: z.array(z.string()).optional(),
  noValuesExtracted: z.boolean().optional(),
  accuracy: z.number().min(0).max(1).optional(),
  extractionSource: z.enum(['llm_payload', 'regex']).optional(),
  timeframeUsed: z.string().optional(),
  maxDeviationFound: z.number().optional(),
  maxAllowedDeviationPercent: z.number().optional(),
  allowedDeviationByField: z.record(z.number()).optional(),
}).optional();
export type TradingSignalValidationSummary = z.infer<typeof TradingSignalValidationSummarySchema>;

// Zod schema para metadados de trading (JSONB)
export const TradingSignalMetadataSchema = z.object({
  confidence: z.number().min(0).max(1).optional(),  // Confiança do modelo (0-1)
  reasoning: z.string().optional(),                  // Raciocínio do LLM
  indicators: z.record(z.number()).optional(),       // Indicadores técnicos usados
  marketCondition: z.string().optional(),            // Condição de mercado identificada
  riskScore: z.number().min(0).max(100).optional(),  // Score de risco (0-100)
  modelVersion: z.string().optional(),               // Versão do modelo usado
  operationType: TradingOperationTypeSchema.optional(),
  expectedDurationMinutes: z.number().int().min(1).max(43200).optional(),
  expectedDurationLabel: z.string().optional(),
  entryPrice: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  riskReward: z.number().positive().optional(),
  motivators: z.array(z.string().min(2)).optional(),
  invalidationReasons: z.array(z.string().min(2)).optional(),
  tradeSummary: z.string().optional(),
  validationStatus: z.enum(['pending', 'validated', 'failed']).optional(), // Status da validação LLM
  validationId: z.string().uuid().optional(),         // ID da validação LLM
  validationSummary: TradingSignalValidationSummarySchema,
  approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(), // Status da aprovação humana
  approvalReason: z.string().optional(),              // Motivo da aprovação/rejeição
  agentId: z.string().uuid().optional(),              // Agente que gerou o sinal
  namespaceId: z.string().uuid().optional(),          // Namespace do agente
  generationSource: z.enum(['on_demand', 'scheduler', 'chat', 'auto']).optional(), // Origem do sinal
  autoRunId: z.string().uuid().optional(),            // ID da execução automática
  autoDecisionId: z.string().uuid().optional(),       // ID da decisão da execução automática
  correlationId: z.string().optional(),               // Correlation ID da execução
  noTradeReasonCode: z.string().optional(),           // Código estruturado de motivo para hold
  schedulerId: z.string().uuid().optional(),          // Scheduler responsável
  autoEngine: z.boolean().optional(),
  modelsUsed: z.array(z.string()).optional(),
  ragEvidenceIds: z.array(z.string()).optional(),
  timeframes: z.array(z.string()).optional(),         // Timeframes usados na geração
  enabledIndicators: z.array(z.string()).optional(),  // Indicadores habilitados no perfil
  dataSources: TradingProfileDataSourcesSchema.optional(), // Fontes de dados habilitadas
  news: TradingNewsSummarySchema.optional(),              // Notícias usadas na geração (quando habilitado)
  consensus: z.object({
    rule: z.string().optional(),
    overallSignal: z.string().optional(),
    requiredAgree: z.number().optional(),
    agreementRatio: z.number().optional(),
    alignedTimeframes: z.array(z.string()).optional(),
    misalignedTimeframes: z.array(z.string()).optional(),
    isMajorityReached: z.boolean().optional(),
  }).optional(),
  techniques: z.array(TradingTechniqueSchema).optional(),
  ensemble: TradingEnsembleConfigSchema.optional(),
  techniqueScores: z.array(TradingTechniqueScoreSchema).optional(),
  ensembleResult: TradingEnsembleResultSchema.optional(),
  arbitrageSnapshot: TradingArbitrageSnapshotSchema.optional(),
  analysisMatrix: z.array(z.object({
    interval: z.string(),
    analysis: z.record(z.unknown()),
  })).optional(),
  createdByUserId: z.string().uuid().optional(),
  isDeleted: z.boolean().optional(),
  deletedAt: z.string().optional(),
  deletedByUserId: z.string().uuid().optional(),
});
export type TradingSignalMetadata = z.infer<typeof TradingSignalMetadataSchema>;

export const TradingOrderMetadataSchema = z.object({
  kucoinOrderId: z.string().optional(),              // ID da ordem na KuCoin
  kucoinClientOid: z.string().optional(),            // Client order ID
  signalId: z.string().uuid().optional(),            // ID do sinal que gerou a ordem
  leverage: z.number().min(1).max(100).optional(),   // Alavancagem usada
  executionPrice: z.number().positive().optional(),  // Preço de execução real
  fees: z.number().optional(),                       // Taxas pagas
  slippage: z.number().optional(),                   // Slippage em %
  responseTime: z.number().optional(),               // Tempo de resposta da exchange (ms)
  closePosition: z.boolean().optional(),             // Ordem criada para fechar posição
  entrySnapshotId: z.string().uuid().optional(),     // ID do snapshot de entrada (capturado ao preencher ordem)
  stopLoss: z.number().optional(),                   // Preço de stop loss (se aplicável)
  takeProfit: z.number().optional(),                 // Preço de take profit (se aplicável)
  stopOrderIds: z.array(z.string()).optional(),       // IDs de stop orders criadas na KuCoin
  review: z.object({
    reason: z.string().optional(),
    source: z.enum(['signal', 'manual']).optional(),
    sizeRule: z.string().optional(),
    suggestedSize: z.number().optional(),
  }).optional(),
  createdByUserId: z.string().uuid().optional(),
  source: z.enum(['signal', 'manual']).optional(),
  isDeleted: z.boolean().optional(),
  deletedAt: z.string().optional(),
  deletedByUserId: z.string().uuid().optional(),
});

export type TradingOrderMetadata = z.infer<typeof TradingOrderMetadataSchema>;

export const TradingPositionMetadataSchema = z.object({
  entrySignalId: z.string().uuid().optional(),       // Sinal que abriu a posição
  exitSignalId: z.string().uuid().optional(),        // Sinal que fechou a posição
  maxDrawdown: z.number().optional(),                // Máximo drawdown durante a posição
  maxProfit: z.number().optional(),                  // Máximo profit durante a posição
  holdingTime: z.number().optional(),                // Tempo de hold em segundos
  closingReason: z.string().optional(),              // Motivo do fechamento
});
export type TradingPositionMetadata = z.infer<typeof TradingPositionMetadataSchema>;

// SINAIS DE TRADING (Gate 2)
// - Sinais de texto: gerados pelo LLM (Qwen2.5 7B) com RAG
// - Análise de imagens/gráficos (quando aplicável): via OpenAI Vision em fluxo separado
// Cada sinal é uma recomendação do LLM baseada em análise de mercado
export const tradingSignals = pgTable(
  "trading_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    signalType: tradingSignalTypeEnum("signal_type").notNull(),
    marketType: tradingMarketTypeEnum("market_type").notNull().default("futures"),
    symbol: varchar("symbol", { length: 50 }).notNull(), // Par de trading
    suggestedPrice: real("suggested_price"),           // Preço sugerido para entrada
    suggestedStopLoss: real("suggested_stop_loss"),    // Stop loss sugerido
    suggestedTakeProfit: real("suggested_take_profit"), // Take profit sugerido
    suggestedSize: real("suggested_size"),             // Tamanho sugerido (% do capital)
    confidence: real("confidence"),                    // Confiança (0-1)
    metadata: jsonb("metadata").$type<TradingSignalMetadata>().default({}),
    executedAt: timestamp("executed_at"),              // Quando foi executado (null se não executado)
    executedOrderId: uuid("executed_order_id"),        // ID da ordem que executou o sinal
    isActive: boolean("is_active").default(true),      // Se o sinal ainda é válido
    expiresAt: timestamp("expires_at"),                // Quando o sinal expira
    /** Preenchido quando um trading_dataset foi criado a partir deste sinal (evita envio duplo). */
    sentToTrainingAt: timestamp("sent_to_training_at"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxSignalsTenant: index("idx_trading_signals_tenant").on(table.tenantId),
    idxSignalsType: index("idx_trading_signals_type").on(table.signalType),
    idxSignalsMarketType: index("idx_trading_signals_market_type").on(table.marketType),
    idxSignalsActive: index("idx_trading_signals_active").on(table.isActive),
    idxSignalsCreated: index("idx_trading_signals_created").on(table.criadoEm),
    idxSignalsSymbol: index("idx_trading_signals_symbol").on(table.symbol),
  })
);

// ============================================================================
// SCHEDULER DE SINAIS (LLM Runtime)
// ============================================================================
export const tradingSignalSchedulers = pgTable(
  "trading_signal_schedulers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    agentId: uuid("agent_id").references(() => agents.id),
    namespaceId: uuid("namespace_id").references(() => namespaces.id),
    marketType: tradingMarketTypeEnum("market_type").notNull().default("futures"),
    marginMode: tradingMarginModeEnum("margin_mode").default("cross"),
    intervalMinutes: integer("interval_minutes").notNull().default(15),
    interval: varchar("interval", { length: 10 }).notNull().default("5m"),
    symbols: text("symbols").array().default([]),
    maxSignalsPerRun: integer("max_signals_per_run").notNull().default(1),
    techniques: tradingTechniqueEnum("techniques").array(),
    ensembleConfig: jsonb("ensemble_config").$type<TradingEnsembleConfig | null>().default(sql`NULL`),
    arbitrageConfig: jsonb("arbitrage_config").$type<TradingArbitrageConfig | null>().default(sql`NULL`),
    enabled: boolean("enabled").notNull().default(false),
    lastRunAt: timestamp("last_run_at"),
    nextRunAt: timestamp("next_run_at"),
    lastSuccessAt: timestamp("last_success_at"),
    lastSignalId: uuid("last_signal_id").references(() => tradingSignals.id),
    lastDurationMs: integer("last_duration_ms"),
    lastError: text("last_error"),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxSignalSchedulerTenant: index("idx_trading_signal_scheduler_tenant").on(table.tenantId),
    idxSignalSchedulerMarketType: index("idx_trading_signal_scheduler_market").on(table.marketType),
    idxSignalSchedulerEnabled: index("idx_trading_signal_scheduler_enabled").on(table.enabled),
    idxSignalSchedulerNextRun: index("idx_trading_signal_scheduler_next_run").on(table.nextRunAt),
    idxSignalSchedulerTenantMarket: uniqueIndex("idx_trading_signal_scheduler_tenant_market").on(table.tenantId, table.marketType),
  })
);

// ============================================================================
// SCHEDULER DE ANÁLISE (CPU/determinístico)
// ============================================================================
export const tradingAnalysisSchedulers = pgTable(
  "trading_analysis_schedulers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    marketType: tradingMarketTypeEnum("market_type").notNull().default("futures"),
    marginMode: tradingMarginModeEnum("margin_mode").default("cross"),
    intervalMinutes: integer("interval_minutes").notNull().default(15),
    interval: varchar("interval", { length: 10 }).notNull().default("5m"),
    symbols: text("symbols").array().default([]),
    maxSymbolsPerRun: integer("max_symbols_per_run").notNull().default(1),
    techniques: tradingTechniqueEnum("techniques").array(),
    ensembleConfig: jsonb("ensemble_config").$type<TradingEnsembleConfig | null>().default(sql`NULL`),
    arbitrageConfig: jsonb("arbitrage_config").$type<TradingArbitrageConfig | null>().default(sql`NULL`),
    enabled: boolean("enabled").notNull().default(false),
    lastRunAt: timestamp("last_run_at"),
    nextRunAt: timestamp("next_run_at"),
    lastSuccessAt: timestamp("last_success_at"),
    lastIndicatorId: uuid("last_indicator_id").references(() => tradingTechnicalIndicators.id),
    lastDurationMs: integer("last_duration_ms"),
    lastError: text("last_error"),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxAnalysisSchedulerTenant: index("idx_trading_analysis_scheduler_tenant").on(table.tenantId),
    idxAnalysisSchedulerMarketType: index("idx_trading_analysis_scheduler_market").on(table.marketType),
    idxAnalysisSchedulerEnabled: index("idx_trading_analysis_scheduler_enabled").on(table.enabled),
    idxAnalysisSchedulerNextRun: index("idx_trading_analysis_scheduler_next_run").on(table.nextRunAt),
    idxAnalysisSchedulerTenantMarket: uniqueIndex("idx_trading_analysis_scheduler_tenant_market").on(table.tenantId, table.marketType),
  })
);

// ============================================================================
// PERFIS DE ANÁLISE/SINAIS (Multi-timeframe + Indicadores + Fontes)
// ============================================================================
export const tradingAnalysisProfiles = pgTable(
  "trading_analysis_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    kind: tradingProfileKindEnum("kind").notNull(),
    name: varchar("name", { length: 100 }).notNull().default("default"),
    timeframes: tradingIntervalEnum("timeframes").array().notNull()
      .default(sql`ARRAY['5m']::trading_interval[]`),
    indicators: jsonb("indicators").$type<TradingIndicatorKey[]>().notNull()
      .default(sql`'["rsi","macd","moving_averages","bollinger","atr","stochastic","adx","support_resistance","volume"]'::jsonb`),
    dataSources: jsonb("data_sources").$type<TradingProfileDataSources>().notNull()
      .default(sql`'{"orderBook": false, "news": false, "trainingData": false}'::jsonb`),
    techniques: tradingTechniqueEnum("techniques").array().notNull()
      .default(sql`ARRAY['scalping','day_trade','swing','position','trend','mean_reversion','breakout','range','momentum']::trading_technique[]`),
    ensembleConfig: jsonb("ensemble_config").$type<TradingEnsembleConfig>().notNull()
      .default(sql`'{"mode":"ensemble_top3","topN":3}'::jsonb`),
    arbitrageConfig: jsonb("arbitrage_config").$type<TradingArbitrageConfig | null>()
      .default(sql`NULL`),
    modelConfig: jsonb("model_config").$type<TradingProfileModelConfig>().notNull()
      .default(sql`'{}'::jsonb`),
    newsConfig: jsonb("news_config").$type<TradingProfileNewsConfig>().notNull()
      .default(sql`'{"engines":[],"categories":"general","language":"pt-BR","safesearch":"1","timeRange":"last_24_hours","queryTemplates":["{symbol} {marketType} news {terms}"],"extraTerms":[],"maxResults":5}'::jsonb`),
    consensus: jsonb("consensus").$type<TradingProfileConsensus>().notNull()
      .default(sql`'{"rule":"majority"}'::jsonb`),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxProfilesTenant: index("idx_trading_profiles_tenant").on(table.tenantId),
    idxProfilesKind: index("idx_trading_profiles_kind").on(table.kind),
    idxProfilesTenantKind: uniqueIndex("idx_trading_profiles_tenant_kind").on(table.tenantId, table.kind),
  })
);

// ============================================================================
// PRESETS DE NOTÍCIAS (SEARXNG) - Trading
// ============================================================================
export const tradingNewsPresets = pgTable(
  "trading_news_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    config: jsonb("config").$type<TradingProfileNewsConfig>().notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxTradingNewsPresetsTenant: index("idx_trading_news_presets_tenant").on(table.tenantId),
    idxTradingNewsPresetsName: index("idx_trading_news_presets_name").on(table.name),
    idxTradingNewsPresetsDefault: index("idx_trading_news_presets_default").on(table.isDefault),
    idxTradingNewsPresetsTenantName: uniqueIndex("idx_trading_news_presets_tenant_name").on(table.tenantId, table.name),
  })
);

// RLS multi-tenant
export const tradingNewsPresetsPolicies = sql`
  ALTER TABLE trading_news_presets ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS trading_news_presets_tenant_isolation ON trading_news_presets;
  CREATE POLICY trading_news_presets_tenant_isolation ON trading_news_presets
    FOR ALL
    USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
    WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
`;

// ============================================================================
// TRADING - INSTRUMENT REGISTRY + PORTFOLIO LAYER
// ============================================================================
export const tradingPortfolioRiskProfileEnum = pgEnum('trading_portfolio_risk_profile', [
  'conservative',
  'balanced',
  'aggressive',
]);

export const tradingBacktestStatusEnum = pgEnum('trading_backtest_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
]);

export const tradingCandidateStatusEnum = pgEnum('trading_candidate_status', [
  'candidate',
  'approved',
  'rejected',
  'expired',
  'executed',
]);

export const tradingCalibrationMethodEnum = pgEnum('trading_calibration_method', ['platt', 'isotonic']);

export const tradingRebalanceStatusEnum = pgEnum('trading_rebalance_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
]);
export const tradingOperationIntentEnum = pgEnum('trading_operation_intent', [
  'scalping',
  'intraday',
  'swing',
  'positional',
  'arbitrage_internal',
  'arbitrage_cross_exchange',
  'cash_and_carry',
  'market_neutral',
  'volatility_breakout',
]);

export const tradingModelRiskScopeEnum = pgEnum('trading_model_risk_scope', ['strategy', 'portfolio', 'instrument']);
export const tradingModelRiskEventTypeEnum = pgEnum('trading_model_risk_event_type', ['drift', 'performance_decay', 'data_quality', 'execution_anomaly', 'kill_switch']);
export const tradingModelRiskSeverityEnum = pgEnum('trading_model_risk_severity', ['low', 'medium', 'high', 'critical']);
export const tradingVenueTypeEnum = pgEnum('trading_venue_type', ['cex', 'dex', 'broker', 'bank']);

export const tradingInstruments = pgTable('trading_instruments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  venue: varchar('venue', { length: 32 }).notNull(),
  venueType: tradingVenueTypeEnum('venue_type').notNull().default('cex'),
  assetClass: varchar('asset_class', { length: 24 }).notNull(),
  symbol: varchar('symbol', { length: 64 }).notNull(),
  baseAsset: varchar('base_asset', { length: 32 }),
  quoteAsset: varchar('quote_asset', { length: 32 }),
  tickSize: numeric('tick_size'),
  lotSize: numeric('lot_size'),
  tradingHours: jsonb('trading_hours').$type<Record<string, unknown>>().notNull().default({}),
  fundingRules: jsonb('funding_rules').$type<Record<string, unknown>>().notNull().default({}),
  minNotional: numeric('min_notional'),
  priceDecimals: integer('price_decimals'),
  sizeDecimals: integer('size_decimals'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  idxTenant: index('idx_trading_instruments_tenant').on(table.tenantId),
  idxAssetClass: index('idx_trading_instruments_asset_class').on(table.assetClass),
  idxSymbol: index('idx_trading_instruments_symbol').on(table.symbol),
  uniqTenantVenueSymbol: uniqueIndex('uniq_trading_instruments_tenant_venue_symbol').on(table.tenantId, table.venue, table.symbol),
}));

export const tradingExchanges = pgTable('trading_exchanges', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  venue: varchar('venue', { length: 32 }).notNull(),
  apiConnected: boolean('api_connected').notNull().default(false),
  supportsSpot: boolean('supports_spot').notNull().default(false),
  supportsFutures: boolean('supports_futures').notNull().default(false),
  supportsMargin: boolean('supports_margin').notNull().default(false),
  feeModelVersion: integer('fee_model_version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  idxTradingExchangesTenant: index('idx_trading_exchanges_tenant').on(table.tenantId),
  uniqTradingExchangesTenantVenue: uniqueIndex('uniq_trading_exchanges_tenant_venue').on(table.tenantId, table.venue),
}));

export const tradingCostModels = pgTable('trading_cost_models', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  venue: varchar('venue', { length: 32 }).notNull(),
  assetClass: varchar('asset_class', { length: 24 }).notNull(),
  marketType: tradingMarketTypeEnum('market_type').notNull(),
  feeBps: numeric('fee_bps').notNull(),
  slippageModel: jsonb('slippage_model').$type<Record<string, unknown>>().notNull().default({}),
  spreadModel: jsonb('spread_model').$type<Record<string, unknown>>().notNull().default({}),
  version: integer('version').notNull().default(1),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  idxTradingCostModelsTenant: index('idx_trading_cost_models_tenant').on(table.tenantId),
  idxTradingCostModelsLookup: index('idx_trading_cost_models_lookup').on(table.tenantId, table.venue, table.assetClass, table.marketType, table.active),
  uniqTradingCostModelsVersion: uniqueIndex('uniq_trading_cost_models_version').on(table.tenantId, table.venue, table.assetClass, table.marketType, table.version),
}));

export const tradingFactorSnapshots = pgTable('trading_factor_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  instrumentId: uuid('instrument_id').notNull().references(() => tradingInstruments.id),
  marketType: tradingMarketTypeEnum('market_type').notNull(),
  interval: tradingIntervalEnum('interval').notNull(),
  candleTimestamp: timestamp('candle_timestamp').notNull(),
  asofTimestamp: timestamp('asof_timestamp').notNull(),
  featureVersion: integer('feature_version').notNull(),
  regimes: jsonb('regimes').$type<Record<string, unknown>>().notNull().default({}),
  factors: jsonb('factors').$type<Record<string, unknown>>().notNull().default({}),
  costsEstimate: jsonb('costs_estimate').$type<Record<string, unknown>>().notNull().default({}),
  expectedReturn: numeric('expected_return'),
  expectedVolatility: numeric('expected_volatility'),
  sharpeProxy: numeric('sharpe_proxy'),
  riskScore: numeric('risk_score'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  uniqSnapshot: uniqueIndex('uniq_trading_factor_snapshots').on(
    table.tenantId,
    table.instrumentId,
    table.marketType,
    table.interval,
    table.candleTimestamp,
    table.featureVersion,
  ),
}));

export const tradingOrderbookSnapshots = pgTable('trading_orderbook_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  instrumentId: uuid('instrument_id').notNull().references(() => tradingInstruments.id),
  marketType: tradingMarketTypeEnum('market_type').notNull(),
  timeframe: tradingIntervalEnum('timeframe').notNull(),
  snapshotAt: timestamp('snapshot_at').notNull(),
  topLevels: jsonb('top_levels').$type<Record<string, unknown>>().notNull().default({}),
  spreadBps: numeric('spread_bps'),
  orderBookImbalance: numeric('order_book_imbalance'),
  depthDropRatio: numeric('depth_drop_ratio'),
  microPrice: numeric('micro_price'),
  retentionUntil: timestamp('retention_until'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  idxTradingOrderbookSnapshotsLookup: index('idx_trading_orderbook_snapshots_lookup').on(table.tenantId, table.instrumentId, table.snapshotAt),
}));

export const tradingTradeTicksAgg = pgTable('trading_trade_ticks_agg', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  instrumentId: uuid('instrument_id').notNull().references(() => tradingInstruments.id),
  marketType: tradingMarketTypeEnum('market_type').notNull(),
  timeframe: tradingIntervalEnum('timeframe').notNull(),
  windowStart: timestamp('window_start').notNull(),
  windowEnd: timestamp('window_end').notNull(),
  buyVolume: numeric('buy_volume').notNull(),
  sellVolume: numeric('sell_volume').notNull(),
  deltaVolume: numeric('delta_volume').notNull(),
  cvd: numeric('cvd').notNull(),
  tradesCount: integer('trades_count').notNull().default(0),
  retentionUntil: timestamp('retention_until'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  idxTradingTradeTicksAggLookup: index('idx_trading_trade_ticks_agg_lookup').on(table.tenantId, table.instrumentId, table.windowStart),
  uniqTradingTradeTicksAggWindow: uniqueIndex('uniq_trading_trade_ticks_agg_window').on(
    table.tenantId,
    table.instrumentId,
    table.marketType,
    table.timeframe,
    table.windowStart,
    table.windowEnd,
  ),
}));

export const tradingMicrostructureAgg = pgTable('trading_microstructure_agg', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  instrumentId: uuid('instrument_id').notNull().references(() => tradingInstruments.id),
  marketType: tradingMarketTypeEnum('market_type').notNull(),
  intervalSeconds: integer('interval_seconds').notNull(),
  asofTs: timestamp('asof_ts').notNull(),
  metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  idxTradingMicrostructureAggLookup: index('idx_trading_microstructure_agg_lookup').on(
    table.tenantId,
    table.instrumentId,
    table.marketType,
    table.asofTs,
  ),
  uniqTradingMicrostructureAggWindow: uniqueIndex('uniq_trading_microstructure_agg_window').on(
    table.tenantId,
    table.instrumentId,
    table.marketType,
    table.intervalSeconds,
    table.asofTs,
  ),
}));

export const tradingStrategyRegistry = pgTable('trading_strategy_registry', {
  strategyKey: varchar('strategy_key', { length: 64 }).primaryKey(),
  version: integer('version').notNull(),
  operationIntent: tradingOperationIntentEnum('operation_intent').notNull().default('intraday'),
  applicableAssetClasses: text('applicable_asset_classes').array().notNull(),
  applicableMarkets: tradingMarketTypeEnum('applicable_markets').array().notNull(),
  defaultTimeframes: tradingIntervalEnum('default_timeframes').array().notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  uniqVersion: uniqueIndex('uniq_trading_strategy_registry_version').on(table.strategyKey, table.version),
}));

export const tradingUniverseCandidates = pgTable('trading_universe_candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  instrumentId: uuid('instrument_id').notNull().references(() => tradingInstruments.id),
  marketType: tradingMarketTypeEnum('market_type').notNull(),
  marginMode: tradingMarginModeEnum('margin_mode'),
  operationIntent: tradingOperationIntentEnum('operation_intent').notNull().default('intraday'),
  strategyKey: varchar('strategy_key', { length: 64 }).notNull(),
  strategyVersion: integer('strategy_version').notNull(),
  timeframe: tradingIntervalEnum('timeframe').notNull(),
  candleTimestamp: timestamp('candle_timestamp').notNull(),
  side: varchar('side', { length: 16 }).notNull(),
  entryModel: jsonb('entry_model').$type<Record<string, unknown>>().notNull().default({}),
  expectedEdge: numeric('expected_edge'),
  confidenceRaw: numeric('confidence_raw'),
  confidenceCalibrated: numeric('confidence_calibrated'),
  dsrScore: numeric('dsr_score'),
  pboScore: numeric('pbo_score'),
  riskFlags: jsonb('risk_flags').$type<unknown[]>().notNull().default([]),
  status: tradingCandidateStatusEnum('status').notNull().default('candidate'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  idxQuery: index('idx_trading_universe_candidates_query').on(table.tenantId, table.marketType, table.createdAt),
  uniqCandidateScope: uniqueIndex('uniq_trading_universe_candidates_scope').on(
    table.tenantId,
    table.instrumentId,
    table.marketType,
    table.timeframe,
    table.candleTimestamp,
    table.strategyKey,
    table.strategyVersion,
    table.operationIntent,
  ),
}));

export const tradingBacktestRuns = pgTable('trading_backtest_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  instrumentId: uuid('instrument_id').references(() => tradingInstruments.id),
  marketType: tradingMarketTypeEnum('market_type').notNull(),
  operationIntent: tradingOperationIntentEnum('operation_intent').notNull().default('intraday'),
  strategyKey: varchar('strategy_key', { length: 64 }).notNull(),
  strategyVersion: integer('strategy_version').notNull(),
  walkForwardConfig: jsonb('walk_forward_config').$type<Record<string, unknown>>().notNull().default({}),
  costModel: jsonb('cost_model').$type<Record<string, unknown>>().notNull().default({}),
  metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull().default({}),
  oosMetrics: jsonb('oos_metrics').$type<Record<string, unknown>>().notNull().default({}),
  dsr: jsonb('dsr').$type<Record<string, unknown>>(),
  pbo: jsonb('pbo').$type<Record<string, unknown>>(),
  status: tradingBacktestStatusEnum('status').notNull().default('queued'),
  error: text('error'),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tradingSignalCalibration = pgTable('trading_signal_calibration', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  instrumentId: uuid('instrument_id').notNull().references(() => tradingInstruments.id),
  marketType: tradingMarketTypeEnum('market_type').notNull(),
  operationIntent: tradingOperationIntentEnum('operation_intent').notNull().default('intraday'),
  strategyKey: varchar('strategy_key', { length: 64 }).notNull(),
  strategyVersion: integer('strategy_version').notNull(),
  method: tradingCalibrationMethodEnum('method').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  evalMetrics: jsonb('eval_metrics').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  uniqCalibration: uniqueIndex('uniq_trading_signal_calibration').on(
    table.tenantId,
    table.instrumentId,
    table.marketType,
    table.operationIntent,
    table.strategyKey,
    table.strategyVersion,
    table.method,
  ),
}));

export const tradingPortfolios = pgTable('trading_portfolios', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 120 }).notNull(),
  baseCurrency: varchar('base_currency', { length: 16 }).notNull(),
  riskProfile: tradingPortfolioRiskProfileEnum('risk_profile').notNull(),
  maxGrossExposure: numeric('max_gross_exposure').notNull(),
  maxNetExposure: numeric('max_net_exposure').notNull(),
  maxDrawdownLimit: numeric('max_drawdown_limit').notNull(),
  allowedOperationIntents: tradingOperationIntentEnum('allowed_operation_intents').array().notNull().default(['intraday']),
  policy: jsonb('policy').$type<Record<string, unknown>>().notNull().default({}),
  rebalancePolicy: jsonb('rebalance_policy').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tradingPortfolioAllocations = pgTable('trading_portfolio_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  portfolioId: uuid('portfolio_id').notNull().references(() => tradingPortfolios.id),
  instrumentId: uuid('instrument_id').notNull().references(() => tradingInstruments.id),
  targetWeight: numeric('target_weight').notNull(),
  maxWeight: numeric('max_weight').notNull(),
  minWeight: numeric('min_weight').notNull(),
  leverageCap: numeric('leverage_cap'),
  marketType: tradingMarketTypeEnum('market_type').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  uniqAllocation: uniqueIndex('uniq_trading_portfolio_allocations').on(table.portfolioId, table.instrumentId, table.marketType),
}));

export const tradingPortfolioRebalances = pgTable('trading_portfolio_rebalances', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  portfolioId: uuid('portfolio_id').notNull().references(() => tradingPortfolios.id),
  asofTimestamp: timestamp('asof_timestamp').notNull(),
  inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull().default({}),
  decisions: jsonb('decisions').$type<Record<string, unknown>>().notNull().default({}),
  status: tradingRebalanceStatusEnum('status').notNull().default('queued'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tradingExecutionReports = pgTable('trading_execution_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  portfolioId: uuid('portfolio_id').references(() => tradingPortfolios.id),
  instrumentId: uuid('instrument_id').notNull().references(() => tradingInstruments.id),
  marketType: tradingMarketTypeEnum('market_type').notNull(),
  orderPayload: jsonb('order_payload').$type<Record<string, unknown>>().notNull().default({}),
  executionResult: jsonb('execution_result').$type<Record<string, unknown>>().notNull().default({}),
  estimatedCosts: jsonb('estimated_costs').$type<Record<string, unknown>>().notNull().default({}),
  realizedCosts: jsonb('realized_costs').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tradingModelRiskEvents = pgTable('trading_model_risk_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  scope: tradingModelRiskScopeEnum('scope').notNull(),
  scopeKey: varchar('scope_key', { length: 128 }).notNull(),
  eventType: tradingModelRiskEventTypeEnum('event_type').notNull(),
  severity: tradingModelRiskSeverityEnum('severity').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ORDENS DE TRADING (OMS - Order Management System)
// Registro completo de todas as ordens enviadas para a exchange
export const tradingOrders = pgTable(
  "trading_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    signalId: uuid("signal_id").references(() => tradingSignals.id), // Sinal que gerou a ordem (opcional)
    marketType: tradingMarketTypeEnum("market_type").notNull().default("futures"),
    symbol: varchar("symbol", { length: 50 }).notNull(),
    side: tradingOrderSideEnum("side").notNull(),
    orderType: tradingOrderTypeEnum("order_type").notNull(),
    status: tradingOrderStatusEnum("status").default("pending"),
    price: real("price"),                              // Preço da ordem (null para market)
    stopPrice: real("stop_price"),                     // Preço de stop (para stop orders)
    size: real("size").notNull(),                      // Quantidade (contratos)
    leverage: integer("leverage").default(1),          // Alavancagem (1-100x)
    riskGateDecision: varchar("risk_gate_decision", { length: 16 }).default("allow"),
    riskGateReason: text("risk_gate_reason"),
    filledSize: real("filled_size").default(0),        // Quantidade executada
    avgFilledPrice: real("avg_filled_price"),          // Preço médio de execução
    fees: real("fees").default(0),                     // Taxas pagas
    kucoinOrderId: varchar("kucoin_order_id", { length: 100 }), // ID na exchange
    clientOid: varchar("client_oid", { length: 100 }), // ID do cliente (idempotência)
    metadata: jsonb("metadata").$type<TradingOrderMetadata>().default({}),
    errorMessage: text("error_message"),               // Mensagem de erro se houver
    submittedAt: timestamp("submitted_at"),            // Quando foi enviada
    filledAt: timestamp("filled_at"),                  // Quando foi completamente executada
    cancelledAt: timestamp("cancelled_at"),            // Quando foi cancelada
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxOrdersTenant: index("idx_trading_orders_tenant").on(table.tenantId),
    idxOrdersStatus: index("idx_trading_orders_status").on(table.status),
    idxOrdersMarketType: index("idx_trading_orders_market_type").on(table.marketType),
    idxOrdersKucoin: index("idx_trading_orders_kucoin").on(table.kucoinOrderId),
    idxOrdersClientOid: index("idx_trading_orders_client_oid").on(table.clientOid),
    idxOrdersSymbol: index("idx_trading_orders_symbol").on(table.symbol),
    idxOrdersCreated: index("idx_trading_orders_created").on(table.criadoEm),
  })
);

// POSIÇÕES DE TRADING (EMS - Execution Management System)
// Estado atual das posições abertas e histórico de posições fechadas
export const tradingPositions = pgTable(
  "trading_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    marketType: tradingMarketTypeEnum("market_type").notNull().default("futures"),
    symbol: varchar("symbol", { length: 50 }).notNull(),
    side: tradingOrderSideEnum("side").notNull(),      // long ou short
    status: tradingPositionStatusEnum("status").default("open"),
    entryPrice: real("entry_price").notNull(),         // Preço médio de entrada
    currentPrice: real("current_price"),               // Preço atual (atualizado periodicamente)
    size: real("size").notNull(),                      // Tamanho da posição (contratos)
    leverage: integer("leverage").default(1),          // Alavancagem
    stopLoss: real("stop_loss"),                       // Stop loss atual
    takeProfit: real("take_profit"),                   // Take profit atual
    unrealizedPnl: real("unrealized_pnl"),             // PnL não realizado (atualizado periodicamente)
    realizedPnl: real("realized_pnl"),                 // PnL realizado (quando fechada)
    totalFees: real("total_fees").default(0),          // Total de taxas pagas
    margin: real("margin"),                            // Margem usada
    liquidationPrice: real("liquidation_price"),       // Preço de liquidação
    metadata: jsonb("metadata").$type<TradingPositionMetadata>().default({}),
    openedAt: timestamp("opened_at").defaultNow(),     // Quando foi aberta
    closedAt: timestamp("closed_at"),                  // Quando foi fechada
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxPositionsTenant: index("idx_trading_positions_tenant").on(table.tenantId),
    idxPositionsStatus: index("idx_trading_positions_status").on(table.status),
    idxPositionsMarketType: index("idx_trading_positions_market_type").on(table.marketType),
    idxPositionsSymbol: index("idx_trading_positions_symbol").on(table.symbol),
    idxPositionsOpened: index("idx_trading_positions_opened").on(table.openedAt),
  })
);

// CONFIGURAÇÃO DE RISCO (Por tenant - Risk Management)
// Define limites e parâmetros de risco para cada tenant
export const tradingRiskConfig = pgTable(
  "trading_risk_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id).unique(),
    // Limites de risco
    maxPositionSize: real("max_position_size").default(0.1),     // Máximo % do capital por posição
    maxOrderValue: real("max_order_value").default(10000),       // Valor máximo por ordem em USD (CORREÇÃO 17/12/2025)
    maxDailyLoss: real("max_daily_loss").default(0.05),          // Máxima perda diária % (circuit breaker)
    maxOpenPositions: integer("max_open_positions").default(3),  // Máximo de posições abertas
    maxLeverage: integer("max_leverage").default(10),            // Alavancagem máxima permitida
    // Configurações de execução
    defaultLeverage: integer("default_leverage").default(5),     // Alavancagem padrão
    defaultStopLoss: real("default_stop_loss").default(0.02),    // Stop loss padrão (2%)
    defaultTakeProfit: real("default_take_profit").default(0.04), // Take profit padrão (4%)
    defaultSymbol: varchar("default_symbol", { length: 50 }),    // Símbolo default (dinâmico)
    defaultMarketType: tradingMarketTypeEnum("default_market_type").notNull().default("futures"),
    marginMode: tradingMarginModeEnum("margin_mode").notNull().default("cross"),
    // Controles
    tradingEnabled: boolean("trading_enabled").default(false),   // Se trading está habilitado
    autoExecuteSignals: boolean("auto_execute_signals").default(false), // Execução automática
    minConfidenceToExecute: real("min_confidence_to_execute").default(0.7), // Confiança mínima
    // Credenciais KuCoin (criptografadas)
    kucoinApiKey: text("kucoin_api_key"),             // Criptografado
    kucoinApiSecret: text("kucoin_api_secret"),       // Criptografado  
    kucoinPassphrase: text("kucoin_passphrase"),      // Criptografado
    // Métricas diárias (reset meia-noite UTC)
    dailyPnl: real("daily_pnl").default(0),
    dailyTradeCount: integer("daily_trade_count").default(0),
    lastResetDate: timestamp("last_reset_date"),
    // Timestamps
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxRiskConfigTenant: uniqueIndex("idx_trading_risk_config_tenant").on(table.tenantId),
  })
);

// ============================================================================
// PREFERÊNCIAS DE SÍMBOLOS (Favoritos + Destaques por usuário/mercado)
// ============================================================================
export const tradingSymbolPreferences = pgTable(
  "trading_symbol_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    marketType: tradingMarketTypeEnum("market_type").notNull().default("futures"),
    marginMode: tradingMarginModeEnum("margin_mode").notNull().default("cross"),
    favorites: text("favorites").array().notNull().default([]),
    featured: text("featured").array().notNull().default([]),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxSymbolPrefsTenant: index("idx_trading_symbol_prefs_tenant").on(table.tenantId),
    idxSymbolPrefsUser: index("idx_trading_symbol_prefs_user").on(table.userId),
    idxSymbolPrefsMarket: index("idx_trading_symbol_prefs_market").on(table.marketType),
    idxSymbolPrefsUserMarket: uniqueIndex("idx_trading_symbol_prefs_user_market")
      .on(table.tenantId, table.userId, table.marketType, table.marginMode),
  })
);

// AUDIT LOG DE TRADING (Auditoria completa para compliance)
// Registro imutável de todas as ações de trading
export const tradingAuditLog = pgTable(
  "trading_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    userId: uuid("user_id").references(() => users.id), // Usuário que iniciou (se humano)
    action: varchar("action", { length: 50 }).notNull(), // Tipo de ação
    entityType: varchar("entity_type", { length: 50 }).notNull(), // signal, order, position, config
    entityId: uuid("entity_id"),                        // ID da entidade afetada
    previousState: jsonb("previous_state").$type<Record<string, unknown>>(), // Estado anterior
    newState: jsonb("new_state").$type<Record<string, unknown>>(),          // Novo estado
    ipAddress: varchar("ip_address", { length: 45 }),   // IP do usuário
    userAgent: text("user_agent"),                      // User agent
    reason: text("reason"),                             // Motivo da ação
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxAuditLogTenant: index("idx_trading_audit_log_tenant").on(table.tenantId),
    idxAuditLogAction: index("idx_trading_audit_log_action").on(table.action),
    idxAuditLogEntity: index("idx_trading_audit_log_entity").on(table.entityType, table.entityId),
    idxAuditLogCreated: index("idx_trading_audit_log_created").on(table.criadoEm),
  })
);

// Relations de Trading
export const tradingSignalsRelations = relations(tradingSignals, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [tradingSignals.tenantId],
    references: [tenants.id],
  }),
  orders: many(tradingOrders),
}));

export const tradingOrdersRelations = relations(tradingOrders, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tradingOrders.tenantId],
    references: [tenants.id],
  }),
  signal: one(tradingSignals, {
    fields: [tradingOrders.signalId],
    references: [tradingSignals.id],
  }),
}));

export const tradingPositionsRelations = relations(tradingPositions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tradingPositions.tenantId],
    references: [tenants.id],
  }),
}));

export const tradingRiskConfigRelations = relations(tradingRiskConfig, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tradingRiskConfig.tenantId],
    references: [tenants.id],
  }),
}));

export const tradingSymbolPreferencesRelations = relations(tradingSymbolPreferences, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tradingSymbolPreferences.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [tradingSymbolPreferences.userId],
    references: [users.id],
  }),
}));

export const tradingAuditLogRelations = relations(tradingAuditLog, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tradingAuditLog.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [tradingAuditLog.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// TRADING CONTROL HISTORY (17/12/2025)
// Histórico de handover/takeover entre Alice (IA) e operador humano
// ============================================================================

// HISTÓRICO DE CONTROLE DE TRADING (Handover/Takeover)
// Registro imutável de todas as mudanças de controle
export const tradingControlHistory = pgTable(
  "trading_control_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    previousMode: varchar("previous_mode", { length: 20 }).notNull(), // 'alice' | 'manual'
    newMode: varchar("new_mode", { length: 20 }).notNull(),           // 'alice' | 'manual'
    changedBy: uuid("changed_by").references(() => users.id),         // Usuário que fez a mudança
    reason: text("reason"),                                           // Motivo da mudança
    metadata: jsonb("metadata"),                                      // Dados adicionais
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxControlHistoryTenant: index("idx_trading_control_history_tenant").on(table.tenantId),
    idxControlHistoryCreated: index("idx_trading_control_history_created").on(table.criadoEm),
    idxControlHistoryChangedBy: index("idx_trading_control_history_changed_by").on(table.changedBy),
  })
);

export const tradingControlHistoryRelations = relations(tradingControlHistory, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tradingControlHistory.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [tradingControlHistory.changedBy],
    references: [users.id],
  }),
}));

// Tipos TypeScript para Trading Control History
export type TradingControlHistory = typeof tradingControlHistory.$inferSelect;
export type InsertTradingControlHistory = typeof tradingControlHistory.$inferInsert;

// ============================================================================
// TRADING TECHNICAL INDICATORS (21/12/2025)
// Indicadores técnicos calculados por código (determinísticos)
// Elimina alucinações do LLM ao fornecer dados reais calculados
// ============================================================================

// Enum para interpretações de indicadores
export const indicatorInterpretationEnum = pgEnum("indicator_interpretation", [
  "oversold",
  "neutral", 
  "overbought"
]);

// Enum para tendências
export const trendEnum = pgEnum("trend", [
  "bullish",
  "bearish",
  "sideways"
]);

// Enum para força de tendência (ADX)
export const trendStrengthEnum = pgEnum("trend_strength", [
  "weak",
  "moderate",
  "strong",
  "very_strong"
]);

// Enum para volatilidade
export const volatilityEnum = pgEnum("volatility", [
  "low",
  "medium",
  "high"
]);

// Enum para interpretação de volume
export const volumeInterpretationEnum = pgEnum("volume_interpretation", [
  "low",
  "normal",
  "high",
  "very_high"
]);

// Enum para crossover MACD
export const macdCrossoverEnum = pgEnum("macd_crossover", [
  "bullish_cross",
  "bearish_cross",
  "none"
]);

// Enum para sinal geral
export const overallSignalEnum = pgEnum("overall_signal", [
  "strong_buy",
  "buy",
  "neutral",
  "sell",
  "strong_sell"
]);

// Enum para ação de validação
export const validationActionEnum = pgEnum("validation_action", [
  "approved",
  "rejected",
  "flagged_for_review"
]);

// Enum para motivo de validação
export const llmValidationReasonEnum = pgEnum("llm_validation_reason", [
  "ok",
  "no_values",
  "discrepancy",
]);

// Enum para origem da extração
export const llmValidationExtractionSourceEnum = pgEnum("llm_validation_extraction_source", [
  "llm_payload",
  "regex",
]);

// Tabela de indicadores técnicos calculados
export const tradingTechnicalIndicators = pgTable(
  "trading_technical_indicators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    
    // Identificação temporal
    symbol: varchar("symbol", { length: 50 }).notNull(),
    interval: tradingIntervalEnum("interval").notNull(),
    calculatedAt: timestamp("calculated_at").defaultNow(),
    candleTimestamp: timestamp("candle_timestamp").notNull(),
    
    // Preço atual
    currentPrice: real("current_price").notNull(),
    
    // RSI
    rsiValue: real("rsi_value"),
    rsiInterpretation: indicatorInterpretationEnum("rsi_interpretation"),
    rsiPeriod: integer("rsi_period").default(14),
    
    // MACD
    macdLine: real("macd_line"),
    macdSignal: real("macd_signal"),
    macdHistogram: real("macd_histogram"),
    macdInterpretation: trendEnum("macd_interpretation"),
    macdCrossover: macdCrossoverEnum("macd_crossover"),
    
    // Médias Móveis Exponenciais
    ema9: real("ema_9"),
    ema21: real("ema_21"),
    ema50: real("ema_50"),
    ema200: real("ema_200"),
    
    // Médias Móveis Simples
    sma20: real("sma_20"),
    sma50: real("sma_50"),
    sma200: real("sma_200"),
    
    // Tendência
    maTrend: trendEnum("ma_trend"),
    
    // Bollinger Bands
    bollingerUpper: real("bollinger_upper"),
    bollingerMiddle: real("bollinger_middle"),
    bollingerLower: real("bollinger_lower"),
    bollingerWidth: real("bollinger_width"),
    bollingerPercentB: real("bollinger_percent_b"),
    bollingerInterpretation: indicatorInterpretationEnum("bollinger_interpretation"),
    
    // ATR
    atrValue: real("atr_value"),
    atrPercentage: real("atr_percentage"),
    atrVolatility: volatilityEnum("atr_volatility"),
    
    // Stochastic
    stochasticK: real("stochastic_k"),
    stochasticD: real("stochastic_d"),
    stochasticInterpretation: indicatorInterpretationEnum("stochastic_interpretation"),
    
    // ADX
    adxValue: real("adx_value"),
    adxPlusDI: real("adx_plus_di"),
    adxMinusDI: real("adx_minus_di"),
    adxTrendStrength: trendStrengthEnum("adx_trend_strength"),
    
    // Suporte e Resistência
    pivotPoint: real("pivot_point"),
    resistance1: real("resistance_1"),
    resistance2: real("resistance_2"),
    resistance3: real("resistance_3"),
    support1: real("support_1"),
    support2: real("support_2"),
    support3: real("support_3"),
    
    // Volume
    currentVolume: real("current_volume"),
    averageVolume: real("average_volume"),
    volumeRatio: real("volume_ratio"),
    obv: real("obv"),
    volumeInterpretation: volumeInterpretationEnum("volume_interpretation"),
    
    // Sinal geral
    overallSignal: overallSignalEnum("overall_signal").notNull(),
    signalConfidence: real("signal_confidence").notNull(),
    
    // Metadata
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxIndicatorsTenant: index("idx_trading_indicators_tenant").on(table.tenantId),
    idxIndicatorsSymbolInterval: index("idx_trading_indicators_symbol_interval").on(table.symbol, table.interval),
    idxIndicatorsCalculatedAt: index("idx_trading_indicators_calculated_at").on(table.calculatedAt),
    idxIndicatorsSignal: index("idx_trading_indicators_signal").on(table.overallSignal),
  })
);

// Tabela de validação cruzada LLM
export const tradingLlmValidations = pgTable(
  "trading_llm_validations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    
    // Referências
    signalId: uuid("signal_id").references(() => tradingSignals.id),
    indicatorSnapshotId: uuid("indicator_snapshot_id").references(() => tradingTechnicalIndicators.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    
    // Valores citados pelo LLM
    llmCitedValues: jsonb("llm_cited_values").$type<Record<string, number>>().notNull(),
    
    // Valores reais calculados
    actualValues: jsonb("actual_values").$type<Record<string, number>>().notNull(),
    
    // Resultado da validação
    validationPassed: boolean("validation_passed").notNull(),
    discrepancies: jsonb("discrepancies").$type<Record<string, { cited: number; actual: number; diff: number }>>(),
    maxAllowedDeviation: real("max_allowed_deviation").default(0.01),
    failureReason: llmValidationReasonEnum("failure_reason"),
    extractionSource: llmValidationExtractionSourceEnum("extraction_source"),
    noValuesExtracted: boolean("no_values_extracted").default(false),
    overallAccuracy: real("overall_accuracy"),
    failedFields: text("failed_fields").array(),
    timeframeUsed: varchar("timeframe_used", { length: 10 }),
    allowedDeviationByField: jsonb("allowed_deviation_by_field").$type<Record<string, number>>(),
    maxDeviationFound: real("max_deviation_found"),
    
    // Ação tomada
    actionTaken: validationActionEnum("action_taken"),
    
    validatedAt: timestamp("validated_at").defaultNow(),
  },
  (table) => ({
    idxValidationsTenant: index("idx_llm_validations_tenant").on(table.tenantId),
    idxValidationsSignal: index("idx_llm_validations_signal").on(table.signalId),
    idxValidationsPassed: index("idx_llm_validations_passed").on(table.validationPassed),
    idxValidationsDate: index("idx_llm_validations_date").on(table.validatedAt),
  })
);

// Relations
export const tradingTechnicalIndicatorsRelations = relations(tradingTechnicalIndicators, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tradingTechnicalIndicators.tenantId],
    references: [tenants.id],
  }),
}));

export const tradingLlmValidationsRelations = relations(tradingLlmValidations, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tradingLlmValidations.tenantId],
    references: [tenants.id],
  }),
  signal: one(tradingSignals, {
    fields: [tradingLlmValidations.signalId],
    references: [tradingSignals.id],
  }),
  indicatorSnapshot: one(tradingTechnicalIndicators, {
    fields: [tradingLlmValidations.indicatorSnapshotId],
    references: [tradingTechnicalIndicators.id],
  }),
  conversation: one(conversations, {
    fields: [tradingLlmValidations.conversationId],
    references: [conversations.id],
  }),
}));

// Tipos TypeScript
export type TradingTechnicalIndicators = typeof tradingTechnicalIndicators.$inferSelect;
export type InsertTradingTechnicalIndicators = typeof tradingTechnicalIndicators.$inferInsert;
export type TradingLlmValidation = typeof tradingLlmValidations.$inferSelect;
export type InsertTradingLlmValidation = typeof tradingLlmValidations.$inferInsert;
export type TradingInstrument = typeof tradingInstruments.$inferSelect;
export type InsertTradingInstrument = typeof tradingInstruments.$inferInsert;
export type TradingUniverseCandidate = typeof tradingUniverseCandidates.$inferSelect;
export type InsertTradingUniverseCandidate = typeof tradingUniverseCandidates.$inferInsert;
export type TradingBacktestRun = typeof tradingBacktestRuns.$inferSelect;
export type InsertTradingBacktestRun = typeof tradingBacktestRuns.$inferInsert;
export type TradingPortfolio = typeof tradingPortfolios.$inferSelect;
export type InsertTradingPortfolio = typeof tradingPortfolios.$inferInsert;
export type TradingPortfolioAllocation = typeof tradingPortfolioAllocations.$inferSelect;
export type InsertTradingPortfolioAllocation = typeof tradingPortfolioAllocations.$inferInsert;
export type TradingPortfolioRebalance = typeof tradingPortfolioRebalances.$inferSelect;
export type InsertTradingPortfolioRebalance = typeof tradingPortfolioRebalances.$inferInsert;
export type TradingExecutionReport = typeof tradingExecutionReports.$inferSelect;
export type InsertTradingExecutionReport = typeof tradingExecutionReports.$inferInsert;
export type TradingModelRiskEvent = typeof tradingModelRiskEvents.$inferSelect;
export type InsertTradingModelRiskEvent = typeof tradingModelRiskEvents.$inferInsert;

// ============================================================================
// TRADING AUTO ENGINE (Auto Runs, Steps, Decisions)
// Rastreamento de execuções automáticas (pipeline institucional de portfólio e sinais IA)
// ============================================================================

export const tradingAutoRunTypeEnum = pgEnum('trading_auto_run_type', [
  'signal_auto',
  'portfolio_auto',
]);

export const tradingAutoRunStatusEnum = pgEnum('trading_auto_run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const tradingAutoStepNameEnum = pgEnum('trading_auto_step_name', [
  'universe-scan',
  'backtest',
  'calibration',
  'model-risk',
  'rebalance',
  'signal-decision',
  'signal-llm',
  'signal-persist',
]);

export const tradingAutoStepStatusEnum = pgEnum('trading_auto_step_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
]);

/** Rastreia execuções "Auto" (signal_auto | portfolio_auto) */
export const tradingAutoRuns = pgTable('trading_auto_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull(),
  runType: tradingAutoRunTypeEnum('run_type').notNull(),
  status: tradingAutoRunStatusEnum('status').notNull().default('queued'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  correlationId: varchar('correlation_id', { length: 64 }),
  namespaceId: uuid('namespace_id'),
  error: text('error'),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** Etapas por run (universe/backtest/calibration/model-risk/rebalance/signal-decision) */
export const tradingAutoRunSteps = pgTable('trading_auto_run_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => tradingAutoRuns.id, { onDelete: 'cascade' }),
  stepName: tradingAutoStepNameEnum('step_name').notNull(),
  status: tradingAutoStepStatusEnum('status').notNull().default('pending'),
  metrics: jsonb('metrics').$type<Record<string, unknown>>().default({}),
  error: text('error'),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/** Decisões finais (sinal/portfólio) com guardrails, custos, evidências */
export const tradingAutoDecisions = pgTable('trading_auto_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => tradingAutoRuns.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  decisionType: tradingAutoRunTypeEnum('decision_type').notNull(),
  entryPayload: jsonb('entry_payload').$type<Record<string, unknown>>().notNull().default({}),
  exitPayload: jsonb('exit_payload').$type<Record<string, unknown>>().default({}),
  guardrails: jsonb('guardrails').$type<Record<string, unknown>>().default({}),
  estimatedCosts: jsonb('estimated_costs').$type<Record<string, unknown>>().default({}),
  slippageEstimate: jsonb('slippage_estimate').$type<Record<string, unknown>>().default({}),
  candidateIds: jsonb('candidate_ids').$type<string[]>().default([]),
  modelsUsed: jsonb('models_used').$type<string[]>().default([]),
  ragEvidenceIds: jsonb('rag_evidence_ids').$type<string[]>().default([]),
  tradingSignalId: uuid('trading_signal_id').references(() => tradingSignals.id, { onDelete: 'set null' }),
  idempotencyHash: varchar('idempotency_hash', { length: 128 }),
  approved: boolean('approved').notNull().default(false),
  reasoning: text('reasoning'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type TradingAutoRun = typeof tradingAutoRuns.$inferSelect;
export type InsertTradingAutoRun = typeof tradingAutoRuns.$inferInsert;
export type TradingAutoRunStep = typeof tradingAutoRunSteps.$inferSelect;
export type InsertTradingAutoRunStep = typeof tradingAutoRunSteps.$inferInsert;
export type TradingAutoDecision = typeof tradingAutoDecisions.$inferSelect;
export type InsertTradingAutoDecision = typeof tradingAutoDecisions.$inferInsert;

// ============================================================================
// TRADING GUARDRAIL THRESHOLDS
// Thresholds institucionais DSR/PBO calibrados por bucket de mercado
// (tenantId × marketType × intent × regime × liquidityTier)
// Calibração via job assíncrono Redis queue com split temporal e embargo.
// Ref: CLAUDE.md Regra 6 (Enterprise-grade, sem hardcode)
// ============================================================================
export const tradingMarketRegimeEnum = pgEnum('trading_market_regime', [
  'low_vol_trend',
  'high_vol_trend',
  'low_vol_range',
  'high_vol_range',
  'unknown',
]);

export const tradingLiquidityTierEnum = pgEnum('trading_liquidity_tier', [
  'high',
  'medium',
  'low',
  'unknown',
]);

export const tradingGuardrailThresholds = pgTable('trading_guardrail_thresholds', {
  id: uuid('id').primaryKey().defaultRandom().notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  marketType: tradingMarketTypeEnum('market_type').notNull(),
  intent: tradingOperationIntentEnum('intent').notNull(),
  regime: tradingMarketRegimeEnum('regime').notNull().default('unknown'),
  liquidityTier: tradingLiquidityTierEnum('liquidity_tier').notNull().default('unknown'),
  /** Threshold mínimo de DSR (Deflated Sharpe Ratio); 0 = sem restrição */
  dsrMin: numeric('dsr_min', { precision: 10, scale: 6 }).notNull().default('0'),
  /** Threshold máximo de PBO (Probability of Backtest Overfitting); 1 = sem restrição */
  pboMax: numeric('pbo_max', { precision: 10, scale: 6 }).notNull().default('0.7'),
  /** Número mínimo de amostras exigidas na calibração */
  minSamples: integer('min_samples').notNull().default(30),
  /** Fonte da calibração: backtest_split | manual | bootstrap | default */
  provenance: varchar('provenance', { length: 64 }).notNull().default('default'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqBucket: uniqueIndex('uq_trading_guardrail_thresholds_bucket')
    .on(t.tenantId, t.marketType, t.intent, t.regime, t.liquidityTier),
  idxTenant: index('idx_trading_guardrail_thresholds_tenant').on(t.tenantId),
}));

export type TradingGuardrailThreshold = typeof tradingGuardrailThresholds.$inferSelect;
export type InsertTradingGuardrailThreshold = typeof tradingGuardrailThresholds.$inferInsert;

// ============================================================================
// TRADING LORA DATASET (Gate 2 - Fine-tuning do LLM de texto)
// QLoRA fine-tuning para trading BTC (foco em Finanças/Trading/Matemática)
// Infraestrutura para coleta de dados e treinamento LoRA para trading BTC
// ============================================================================

// Enum para status do dataset
export const tradingDatasetStatusEnum = pgEnum("trading_dataset_status", [
  "pending",     // Aguardando revisão
  "approved",    // Aprovado para treinamento
  "rejected",    // Rejeitado por baixa qualidade
  "used",        // Já usado em um job de treinamento
]);

export const tradingDatasetSourceTypeEnum = pgEnum("trading_dataset_source_type", [
  "signal",
  "order",
  "manual",
  "system",
  "postmortem",
]);

// Enum para tipo de dado de mercado
// Intervalos baseados na API KuCoin Futures (min: 1min, max: 1month)
// Para scalping: 1m, 3m, 5m são essenciais
export const tradingMarketDataTypeEnum = pgEnum("trading_market_data_type", [
  "candle_1m",   // Candle 1 minuto (SCALPING - menor intervalo disponível)
  "candle_3m",   // Candle 3 minutos (SCALPING - curto prazo)
  "candle_5m",   // Candle 5 minutos (SCALPING/SWING)
  "candle_15m",  // Candle 15 minutos
  "candle_30m",  // Candle 30 minutos
  "candle_1h",   // Candle 1 hora
  "candle_2h",   // Candle 2 horas
  "candle_4h",   // Candle 4 horas
  "candle_6h",   // Candle 6 horas
  "candle_8h",   // Candle 8 horas
  "candle_12h",  // Candle 12 horas
  "candle_1d",   // Candle 1 dia
  "candle_1w",   // Candle 1 semana
  "ticker",      // Ticker (preço instantâneo) - pode simular sub-minuto
  "orderbook",   // Snapshot do order book
  "funding_rate", // Taxa de funding (perpetuals)
  "open_interest", // Open interest
]);

// Enum para status do job LoRA (tabela universal lora_jobs)
export const tradingLoraJobStatusEnum = pgEnum("trading_lora_job_status", [
  "queued",      // Na fila
  "preparing",   // Preparando dataset
  "training",    // Em treinamento
  "validating",  // Validando modelo
  "completed",   // Concluído com sucesso
  "failed",      // Falhou
  "cancelled",   // Cancelado
]);

// Origem do job: explicit_job (UI/API) ou scheduled_run (agendado/on-demand)
export const loraJobSourceEnum = pgEnum("lora_job_source", ["explicit_job", "scheduled_run"]);

// Zod schemas para JSONB
export const TradingCandleDataSchema = z.object({
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  turnover: z.number().optional(),
});
export type TradingCandleData = z.infer<typeof TradingCandleDataSchema>;

export const TradingLoraHyperparamsSchema = z.object({
  loraRank: z.number().default(16),
  loraAlpha: z.number().default(32),
  learningRate: z.number().default(2e-4),
  batchSize: z.number().default(4),
  epochs: z.number().default(3),
  warmupSteps: z.number().default(100),
  gradientAccumulationSteps: z.number().int().min(1).default(1),
  maxSteps: z.number().optional(),
  loraDropout: z.number().min(0).max(1).default(0.05),
  lrSchedulerType: z.string().default('linear'),
  maxGradNorm: z.number().positive().default(1),
  targetModules: z.array(z.string()).default(['q_proj', 'v_proj']),
  maxSeqLen: z.number().int().min(256).max(32768).default(2048),
});
export type TradingLoraHyperparams = z.infer<typeof TradingLoraHyperparamsSchema>;

export const TradingLoraMetricsSchema = z.object({
  trainLoss: z.number().optional(),
  evalLoss: z.number().optional(),
  accuracy: z.number().optional(),
  f1Score: z.number().optional(),
  precision: z.number().optional(),
  recall: z.number().optional(),
  profitFactor: z.number().optional(),       // Específico de trading
  sharpeRatio: z.number().optional(),        // Específico de trading
  maxDrawdown: z.number().optional(),        // Específico de trading
  winRate: z.number().optional(),            // Específico de trading
  /** Número de imagens aprovadas incluídas no job (scheduled_run, quando includeImages=true). */
  imagesUsed: z.number().optional(),
});
export type TradingLoraMetrics = z.infer<typeof TradingLoraMetricsSchema>;

// DADOS DE MERCADO HISTÓRICOS (Coleta automática via job scheduler)
// Armazena candles, tickers, funding rates para treinamento
export const tradingMarketData = pgTable(
  "trading_market_data",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: varchar("symbol", { length: 50 }).notNull(),
    dataType: tradingMarketDataTypeEnum("data_type").notNull(),
    timestamp: timestamp("timestamp").notNull(),
    data: jsonb("data").$type<TradingCandleData | Record<string, unknown>>().notNull(),
    source: varchar("source", { length: 50 }).default("kucoin"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxMarketDataSymbol: index("idx_trading_market_data_symbol").on(table.symbol),
    idxMarketDataType: index("idx_trading_market_data_type").on(table.dataType),
    idxMarketDataTimestamp: index("idx_trading_market_data_timestamp").on(table.timestamp),
    // Índice composto para queries de range por símbolo e tipo
    idxMarketDataQuery: index("idx_trading_market_data_query").on(table.symbol, table.dataType, table.timestamp),
    // Constraint de unicidade para evitar duplicatas
    uniqueMarketData: uniqueIndex("unique_trading_market_data").on(table.symbol, table.dataType, table.timestamp),
  })
);

// DATASET DE TREINAMENTO (Pares prompt/response para LoRA)
// Estrutura de conversação para fine-tuning do Qwen2.5
export const tradingDataset = pgTable(
  "trading_dataset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    
    // Contexto de mercado (snapshot no momento da decisão)
    marketContext: jsonb("market_context").$type<{
      symbol: string;
      timestamp: string;
      price: number;
      change24h: number;
      volume24h: number;
      fundingRate: number;
      openInterest: number;
      recentCandles: TradingCandleData[];
      indicators?: Record<string, number>; // RSI, MACD, etc.
    }>().notNull(),
    
    // Prompt (input para o LLM)
    prompt: text("prompt").notNull(),
    
    // Resposta esperada (output ideal)
    response: text("response").notNull(),
    
    // Ação de trading associada
    actionType: tradingSignalTypeEnum("action_type").notNull(), // long, short, hold, etc.
    
    // Resultado real (feedback após trade)
    actualOutcome: jsonb("actual_outcome").$type<{
      profitLoss: number;
      profitLossPercent: number;
      duration: number;       // Duração em minutos
      exitReason: string;     // stop_loss, take_profit, manual, signal
    }>(),
    
    // Qualidade e status
    qualityScore: real("quality_score"),    // 0-1, calculado automaticamente
    status: tradingDatasetStatusEnum("status").default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at"),
    reviewNotes: text("review_notes"),
    
    // Embedding do prompt para deduplicação
    embedding: vector("embedding"),
    semhash: varchar("semhash", { length: 64 }),
    isDuplicate: boolean("is_duplicate").default(false),
    duplicateOfId: uuid("duplicate_of_id"),
    similarityScore: real("similarity_score"),

    // Origem e contexto
    sourceType: tradingDatasetSourceTypeEnum("source_type").notNull().default("manual"),
    sourceId: varchar("source_id", { length: 255 }),
    sourceMetadata: jsonb("source_metadata").$type<GenericMetadata>().default({}),
    
    // Referências
    signalId: uuid("signal_id").references(() => tradingSignals.id),
    orderId: uuid("order_id").references(() => tradingOrders.id),
    usedInJobId: uuid("used_in_job_id"),
    
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxDatasetTenant: index("idx_trading_dataset_tenant").on(table.tenantId),
    idxDatasetStatus: index("idx_trading_dataset_status").on(table.status),
    idxDatasetAction: index("idx_trading_dataset_action").on(table.actionType),
    idxDatasetQuality: index("idx_trading_dataset_quality").on(table.qualityScore),
    idxDatasetSemhash: index("idx_trading_dataset_semhash").on(table.semhash),
    idxDatasetSourceType: index("idx_trading_dataset_source_type").on(table.sourceType),
    idxDatasetSourceId: index("idx_trading_dataset_source_id").on(table.sourceId),
  })
);

// JOBS DE TREINAMENTO LORA - Tabela universal (única fonte de verdade para adapter ativo por escopo)
// Ref: 0060 - Unificação enterprise; zero workarounds; uma tabela, uma lógica
export const loraJobs = pgTable(
  "lora_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    scopeType: trainingScopeTypeEnum("scope_type").notNull().default("namespace"),
    scopeNamespaceId: uuid("scope_namespace_id").references(() => namespaces.id),
    scopeAgentId: uuid("scope_agent_id").references(() => agents.id),
    profileVersion: integer("profile_version").notNull().default(1),
    /** Origem: explicit_job (criado via API/UI) ou scheduled_run (agendado/on-demand). */
    source: loraJobSourceEnum("source").notNull().default("explicit_job"),

    // Identificação
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),

    // Modelo base e configuração (Gate 2 - LLM texto)
    baseModel: varchar("base_model", { length: 255 }).notNull().default("Qwen/Qwen2.5-7B-Instruct-AWQ"),
    // NOTA: Valores default devem corresponder ao TradingLoraHyperparamsSchema
    hyperparameters: jsonb("hyperparameters").$type<TradingLoraHyperparams>().default({
      loraRank: 16,
      loraAlpha: 32,
      learningRate: 2e-4,
      batchSize: 4,
      epochs: 3,
      warmupSteps: 100,
      gradientAccumulationSteps: 1,
      loraDropout: 0.05,
      lrSchedulerType: "linear",
      maxGradNorm: 1,
      targetModules: ["q_proj", "v_proj"],
      maxSeqLen: 2048,
    }),
    
    // Status e progresso
    status: tradingLoraJobStatusEnum("status").default("queued"),
    progress: integer("progress").default(0),
    currentStep: integer("current_step").default(0),
    totalSteps: integer("total_steps"),
    
    // Dados de treinamento
    datasetCount: integer("dataset_count").default(0),
    validationCount: integer("validation_count").default(0),
    datasetVersionId: uuid("dataset_version_id").references(() => trainingDatasetVersions.id),
    /** Incluir trading_dataset no treino (scheduled_run). NULL = inferir de scope_namespace_id (backward compat). */
    includeTradingDataset: boolean("include_trading_dataset"),
    /** Incluir contagem de imagens aprovadas (generated_images) e retornar imagesUsed. */
    includeImages: boolean("include_images").default(false),

    // Métricas (atualizadas durante treinamento)
    metrics: jsonb("metrics").$type<TradingLoraMetrics>().default({}),
    
    // Resultado
    resultAdapterPath: varchar("result_adapter_path", { length: 500 }),  // Path do adapter LoRA
    resultAdapterSize: integer("result_adapter_size"),                    // Tamanho em bytes
    
    // Adapter ativo: indica se este adapter é o atualmente carregado no vLLM para inferência
    // Apenas UM adapter pode estar ativo por vez (constraint gerenciada no código)
    // Ativação automática após aprovação do training job via activateLoraAdapter()
    isActiveAdapter: boolean("is_active_adapter").default(false),
    isActiveByScope: boolean("is_active_by_scope").notNull().default(false),
    
    // Status de aprovação manual: adapter precisa ser aprovado antes de ser ativado
    approvedAt: timestamp("approved_at"),
    approvedBy: uuid("approved_by"),
    
    // Erro
    errorMessage: text("error_message"),
    errorDetails: jsonb("error_details"),
    
    // Timestamps
    queuedAt: timestamp("queued_at").defaultNow(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxLoraJobsTenant: index("idx_lora_jobs_tenant").on(table.tenantId),
    idxLoraJobsScopeType: index("idx_lora_jobs_scope_type").on(table.scopeType),
    idxLoraJobsScopeNamespace: index("idx_lora_jobs_scope_namespace").on(table.scopeNamespaceId),
    idxLoraJobsScopeAgent: index("idx_lora_jobs_scope_agent").on(table.scopeAgentId),
    idxLoraJobsActiveByScope: index("idx_lora_jobs_active_by_scope").on(table.isActiveByScope),
    idxLoraJobsStatus: index("idx_lora_jobs_status").on(table.status),
    idxLoraJobsCreated: index("idx_lora_jobs_created").on(table.criadoEm),
    idxLoraJobsSource: index("idx_lora_jobs_source").on(table.source),
  })
);

// Relations LoRA (tabela universal)
export const tradingMarketDataRelations = relations(tradingMarketData, (_) => ({}));

export const tradingDatasetRelations = relations(tradingDataset, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tradingDataset.tenantId],
    references: [tenants.id],
  }),
  signal: one(tradingSignals, {
    fields: [tradingDataset.signalId],
    references: [tradingSignals.id],
  }),
  order: one(tradingOrders, {
    fields: [tradingDataset.orderId],
    references: [tradingOrders.id],
  }),
  reviewer: one(users, {
    fields: [tradingDataset.reviewedBy],
    references: [users.id],
  }),
}));

export const loraJobsRelations = relations(loraJobs, ({ one }) => ({
  tenant: one(tenants, {
    fields: [loraJobs.tenantId],
    references: [tenants.id],
  }),
}));

// ============================================================================
// SNAPSHOT STORE - Armazena snapshots de mercado para post-mortem e datasets
// ============================================================================
export const tradingSnapshots = pgTable(
  "trading_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    kind: text("kind").notNull(), // market_entry, market_exit, candles, orderbook_top, news, evidence_pack
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    refs: jsonb("refs").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    idxSnapshotsTenant: index("idx_drizzle_snapshots_tenant").on(table.tenantId),
    idxSnapshotsKind: index("idx_drizzle_snapshots_kind").on(table.kind),
    idxSnapshotsCreated: index("idx_drizzle_snapshots_created").on(table.createdAt),
  })
);

export const tradingSnapshotsRelations = relations(tradingSnapshots, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tradingSnapshots.tenantId],
    references: [tenants.id],
  }),
}));

// ============================================================================
// POST-MORTEM ENGINE - Análise automática pós-trade (Two-Phase: CPU + LLM)
// ============================================================================
export const tradingPostmortems = pgTable(
  "trading_postmortems",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    positionId: uuid("position_id").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    fingerprint: text("fingerprint").notNull().unique(),
    status: text("status").notNull().default("queued"), // queued, processing_cpu, completed_cpu, processing_llm, completed, failed
    // Phase 1 CPU
    classification: jsonb("classification").$type<Record<string, unknown>>(),
    evidencePackSnapshotId: uuid("evidence_pack_snapshot_id").references(() => tradingSnapshots.id),
    // Phase 2 LLM
    motivators: jsonb("motivators").$type<unknown[]>().default([]),
    successFactors: jsonb("success_factors").$type<unknown[]>().default([]),
    failureFactors: jsonb("failure_factors").$type<unknown[]>().default([]),
    lessons: jsonb("lessons").$type<Record<string, unknown>>(),
    // Meta
    engineVersions: jsonb("engine_versions").$type<Record<string, string>>().notNull(),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    /** Preenchido quando um trading_dataset foi criado a partir deste post-mortem (evita envio duplo). */
    sentToTrainingAt: timestamp("sent_to_training_at"),
  },
  (table) => ({
    idxPostmortemPosition: index("idx_drizzle_postmortem_position").on(table.positionId),
    idxPostmortemTenantStatus: index("idx_drizzle_postmortem_tenant_status").on(table.tenantId, table.status),
    idxPostmortemCreated: index("idx_drizzle_postmortem_created").on(table.createdAt),
  })
);

export const tradingPostmortemsRelations = relations(tradingPostmortems, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tradingPostmortems.tenantId],
    references: [tenants.id],
  }),
  evidencePackSnapshot: one(tradingSnapshots, {
    fields: [tradingPostmortems.evidencePackSnapshotId],
    references: [tradingSnapshots.id],
  }),
}));

// ============================================================================
// DEMO TRADING - Balances (fundos simulados, auditáveis)
// ============================================================================
export const demoBalances = pgTable(
  "demo_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    currency: text("currency").notNull().default("USDT"),
    available: numeric("available", { precision: 20, scale: 8 }).notNull().default("100000"),
    frozen: numeric("frozen", { precision: 20, scale: 8 }).notNull().default("0"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqTenantCurrency: uniqueIndex("uniq_demo_balance_tenant_currency").on(table.tenantId, table.currency),
  })
);

export const demoBalancesRelations = relations(demoBalances, ({ one }) => ({
  tenant: one(tenants, {
    fields: [demoBalances.tenantId],
    references: [tenants.id],
  }),
}));

// ============================================================================
// DEMO TRADING - Fund History (histórico de adição de fundos)
// ============================================================================
export const demoFundHistory = pgTable(
  "demo_fund_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
    currency: text("currency").notNull().default("USDT"),
    reason: text("reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    idxFundHistoryTenant: index("idx_demo_fund_history_tenant_drizzle").on(table.tenantId),
  })
);

// ============================================================================
// DEMO TRADING - Orders (ordens simuladas)
// ============================================================================
export const demoOrders = pgTable(
  "demo_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    marketType: text("market_type").notNull(), // spot, futures, margin
    symbol: text("symbol").notNull(),
    side: text("side").notNull(), // buy, sell
    orderType: text("order_type").notNull(), // market, limit, stop
    status: text("status").notNull().default("pending"), // pending, open, filled, partially_filled, cancelled, failed
    price: numeric("price", { precision: 20, scale: 8 }),
    stopPrice: numeric("stop_price", { precision: 20, scale: 8 }),
    size: numeric("size", { precision: 20, scale: 8 }).notNull(),
    leverage: integer("leverage").default(1),
    filledSize: numeric("filled_size", { precision: 20, scale: 8 }).default("0"),
    avgFilledPrice: numeric("avg_filled_price", { precision: 20, scale: 8 }),
    fees: numeric("fees", { precision: 20, scale: 8 }).default("0"),
    signalId: uuid("signal_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    filledAt: timestamp("filled_at"),
  },
  (table) => ({
    idxDemoOrdersTenant: index("idx_demo_orders_tenant_drizzle").on(table.tenantId),
    idxDemoOrdersStatus: index("idx_demo_orders_status_drizzle").on(table.tenantId, table.status),
    idxDemoOrdersSymbol: index("idx_demo_orders_symbol_drizzle").on(table.symbol),
  })
);

export const demoOrdersRelations = relations(demoOrders, ({ one }) => ({
  tenant: one(tenants, {
    fields: [demoOrders.tenantId],
    references: [tenants.id],
  }),
}));

// ============================================================================
// DEMO TRADING - Positions (posições simuladas)
// ============================================================================
export const demoPositions = pgTable(
  "demo_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    marketType: text("market_type").notNull(), // spot, futures, margin
    symbol: text("symbol").notNull(),
    side: text("side").notNull(), // long, short
    status: text("status").notNull().default("open"), // open, closed, liquidated
    entryPrice: numeric("entry_price", { precision: 20, scale: 8 }).notNull(),
    exitPrice: numeric("exit_price", { precision: 20, scale: 8 }),
    currentPrice: numeric("current_price", { precision: 20, scale: 8 }),
    size: numeric("size", { precision: 20, scale: 8 }).notNull(),
    leverage: integer("leverage").default(1),
    stopLoss: numeric("stop_loss", { precision: 20, scale: 8 }),
    takeProfit: numeric("take_profit", { precision: 20, scale: 8 }),
    unrealizedPnl: numeric("unrealized_pnl", { precision: 20, scale: 8 }).default("0"),
    realizedPnl: numeric("realized_pnl", { precision: 20, scale: 8 }).default("0"),
    totalFees: numeric("total_fees", { precision: 20, scale: 8 }).default("0"),
    marginAmount: numeric("margin_amount", { precision: 20, scale: 8 }),
    liquidationPrice: numeric("liquidation_price", { precision: 20, scale: 8 }),
    entrySnapshotId: uuid("entry_snapshot_id").references(() => tradingSnapshots.id),
    exitSnapshotId: uuid("exit_snapshot_id").references(() => tradingSnapshots.id),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
  },
  (table) => ({
    idxDemoPositionsTenant: index("idx_demo_positions_tenant_drizzle").on(table.tenantId),
    idxDemoPositionsStatus: index("idx_demo_positions_status_drizzle").on(table.tenantId, table.status),
    idxDemoPositionsSymbol: index("idx_demo_positions_symbol_drizzle").on(table.symbol),
  })
);

export const demoPositionsRelations = relations(demoPositions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [demoPositions.tenantId],
    references: [tenants.id],
  }),
  entrySnapshot: one(tradingSnapshots, {
    fields: [demoPositions.entrySnapshotId],
    references: [tradingSnapshots.id],
    relationName: "entrySnapshot",
  }),
  exitSnapshot: one(tradingSnapshots, {
    fields: [demoPositions.exitSnapshotId],
    references: [tradingSnapshots.id],
    relationName: "exitSnapshot",
  }),
}));

// ============================================================================
// TAKEOVER/HANDOVER (FASE 6.5 - Controle de Conversas Humano/IA)
// ============================================================================

export const conversationControlModeEnum = pgEnum("conversation_control_mode", [
  "bot",           // Alice está respondendo
  "human",         // Agente humano assumiu (takeover)
  "pending_handoff", // Aguardando agente humano
  "hybrid",        // Modo híbrido (sugestões IA + aprovação humana)
]);

export const conversationApprovalPolicyEnum = pgEnum("conversation_approval_policy", [
  "always_confirm", // Sempre pedir confirmação (execução manual)
  "confirm_risky",  // Confirmar apenas ações arriscadas
  "never_confirm",  // Executar tudo sem confirmação
]);

export const escalationTriggerEnum = pgEnum("escalation_trigger", [
  "low_confidence",     // Confiança LLM < 70%
  "fallback_count",     // 3+ fallbacks consecutivos
  "negative_sentiment", // Sentimento negativo detectado
  "keyword_match",      // "falar com humano", "atendente", etc.
  "manual_request",     // Agente solicitou takeover manualmente
  "sla_breach",         // SLA de resposta excedido
]);

export const messageOriginEnum = pgEnum("message_origin", [
  "bot",      // Mensagem gerada pela Alice
  "human",    // Mensagem de agente humano
  "customer", // Mensagem do cliente
  "system",   // Mensagem de sistema (notificações, etc.)
]);

export const conversationStates = pgTable(
  "conversation_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    controlMode: conversationControlModeEnum("control_mode").default("bot"),
    approvalPolicy: conversationApprovalPolicyEnum("approval_policy").default("always_confirm"),
    assignedAgentId: uuid("assigned_agent_id").references(() => users.id),
    pendingSince: timestamp("pending_since"),
    lastBotMessage: timestamp("last_bot_message"),
    lastHumanMessage: timestamp("last_human_message"),
    lastCustomerMessage: timestamp("last_customer_message"),
    confidenceScore: real("confidence_score"),
    fallbackCount: integer("fallback_count").default(0),
    sentimentScore: real("sentiment_score"),
    slaDeadline: timestamp("sla_deadline"),
    slaBreached: boolean("sla_breached").default(false),
    notes: text("notes"),
    metadata: jsonb("metadata").$type<GenericMetadata>().default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxConvStatesConversation: index("idx_conv_states_conversation").on(table.conversationId),
    idxConvStatesControlMode: index("idx_conv_states_control_mode").on(table.controlMode),
    idxConvStatesAssignedAgent: index("idx_conv_states_assigned_agent").on(table.assignedAgentId),
    idxConvStatesPending: index("idx_conv_states_pending").on(table.pendingSince),
    idxConvStatesSla: index("idx_conv_states_sla").on(table.slaDeadline),
  })
);

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id").references(() => users.id),
    role: varchar("role", { length: 50 }).notNull(), // customer, agent, supervisor
    joinedAt: timestamp("joined_at").defaultNow(),
    leftAt: timestamp("left_at"),
    isActive: boolean("is_active").default(true),
    metadata: jsonb("metadata").$type<GenericMetadata>().default({}),
  },
  (table) => ({
    idxConvParticipantsConversation: index("idx_conv_participants_conversation").on(table.conversationId),
    idxConvParticipantsUser: index("idx_conv_participants_user").on(table.userId),
    idxConvParticipantsActive: index("idx_conv_participants_active").on(table.isActive),
  })
);

export const conversationEscalations = pgTable(
  "conversation_escalations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),
    trigger: escalationTriggerEnum("trigger").notNull(),
    fromMode: conversationControlModeEnum("from_mode").notNull(),
    toMode: conversationControlModeEnum("to_mode").notNull(),
    requestedBy: uuid("requested_by").references(() => users.id),
    handledBy: uuid("handled_by").references(() => users.id),
    confidenceAtEscalation: real("confidence_at_escalation"),
    sentimentAtEscalation: real("sentiment_at_escalation"),
    fallbackCountAtEscalation: integer("fallback_count_at_escalation"),
    triggerDetails: jsonb("trigger_details").$type<EscalationTriggerDetails>().default({}),
    resolutionNotes: text("resolution_notes"),
    resolvedAt: timestamp("resolved_at"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxEscalationsConversation: index("idx_escalations_conversation").on(table.conversationId),
    idxEscalationsTrigger: index("idx_escalations_trigger").on(table.trigger),
    idxEscalationsHandler: index("idx_escalations_handler").on(table.handledBy),
    idxEscalationsCreated: index("idx_escalations_created").on(table.criadoEm),
  })
);

// ============================================================================
// MODEL VERSIONS (FASE 8 - Progressive LoRA e Versionamento)
// ============================================================================

export const modelVersionStatusEnum = pgEnum("model_version_status", [
  "training",
  "validating",
  "active",
  "deprecated",
  "rolled_back",
]);

export const modelVersions = pgTable(
  "model_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    /** Escopo do adapter: null = tenant-wide; preenchido = adapter exclusivo do namespace (LoRA por namespace). */
    namespaceId: uuid("namespace_id").references(() => namespaces.id),
    /** Escopo opcional por agente: requer namespaceId preenchido. */
    agentId: uuid("agent_id").references(() => agents.id),
    name: varchar("name", { length: 255 }).notNull(),
    version: integer("version").notNull().default(1),
    // Gate 2: modelo base do LLM (texto) para versionamento/LoRA
    baseModel: varchar("base_model", { length: 100 }).notNull().default("Qwen2.5-7B-Instruct-AWQ"),
    loraPath: text("lora_path"),
    status: modelVersionStatusEnum("status").default("training"),
    fineTuningJobId: uuid("fine_tuning_job_id").references(() => fineTuningJobs.id),
    trainingDataCount: integer("training_data_count").default(0),
    imageDataCount: integer("image_data_count").default(0),
    metrics: jsonb("metrics").$type<ModelVersionMetrics>().default({}),
    baselineMetrics: jsonb("baseline_metrics").$type<ModelVersionMetrics>().default({}),
    improvementPercent: real("improvement_percent"),
    isActive: boolean("is_active").default(false),
    rolledBackFrom: uuid("rolled_back_from"),
    rolledBackReason: text("rolled_back_reason"),
    criadoEm: timestamp("criado_em").defaultNow(),
    ativadoEm: timestamp("ativado_em"),
    deprecadoEm: timestamp("deprecado_em"),
  },
  (table) => ({
    idxModelVersionsTenant: index("idx_model_versions_tenant").on(table.tenantId),
    idxModelVersionsNamespace: index("idx_model_versions_namespace").on(table.namespaceId),
    idxModelVersionsAgent: index("idx_model_versions_agent").on(table.agentId),
    idxModelVersionsStatus: index("idx_model_versions_status").on(table.status),
    idxModelVersionsActive: index("idx_model_versions_active").on(table.isActive),
    idxModelVersionsVersion: index("idx_model_versions_version").on(table.version),
  })
);

// ============================================================================
// AUTO-LEARNING SCHEDULE (FASE 8 - Schedule Agressivo)
// ============================================================================

export const autoLearningScheduleStatusEnum = pgEnum("auto_learning_schedule_status", [
  "scheduled",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const autoLearningSchedule = pgTable(
  "auto_learning_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    scheduleType: varchar("schedule_type", { length: 50 }).notNull(),
    status: autoLearningScheduleStatusEnum("status").default("scheduled"),
    scheduledFor: timestamp("scheduled_for").notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    modelVersionId: uuid("model_version_id").references(() => modelVersions.id),
    loraJobId: uuid("lora_job_id").references(() => loraJobs.id),
    dataCollected: integer("data_collected").default(0),
    imagesCollected: integer("images_collected").default(0),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<GenericMetadata>().default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxAutoLearningTenant: index("idx_auto_learning_tenant").on(table.tenantId),
    idxAutoLearningStatus: index("idx_auto_learning_status").on(table.status),
    idxAutoLearningScheduled: index("idx_auto_learning_scheduled").on(table.scheduledFor),
  })
);

// ============================================================================
// ANALYZED IMAGES (Gate 2 - Vision OpenAI)
// NOTA: Tabela mantida para armazenar imagens analisadas/geradas via OpenAI
// FLUX.1 Schnell REMOVIDO - Alice usa OpenAI para análise e geração
// ============================================================================

export const generatedImageStatusEnum = pgEnum("generated_image_status", [
  "pending",
  "generating",
  "completed",
  "failed",
]);

export const generatedImages = pgTable(
  "generated_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    messageId: uuid("message_id").references(() => messages.id),
    createdBy: uuid("created_by").references(() => users.id),
    
    // Parâmetros de geração
    prompt: text("prompt").notNull(),
    negativePrompt: text("negative_prompt"),
    model: varchar("model", { length: 50 }).default("gpt-image-1"),
    steps: integer("steps").default(4),
    seed: integer("seed"),
    width: integer("width").default(1024),
    height: integer("height").default(1024),
    guidanceScale: real("guidance_scale").default(3.5),
    
    // Status e storage
    status: generatedImageStatusEnum("status").default("pending"),
    imagePath: text("image_path"),
    thumbnailPath: text("thumbnail_path"),
    imageUrl: text("image_url"),
    
    // Embeddings de imagem foram removidos (OpenAI-only para imagens)
    
    // Feedback e aprovação para training
    feedbackScore: integer("feedback_score"), // 1-5 estrelas
    approvedForTraining: boolean("approved_for_training").default(false),
    usedInFineTuning: boolean("used_in_fine_tuning").default(false),
    fineTuningJobId: uuid("fine_tuning_job_id").references(() => fineTuningJobs.id),
    
    // Métricas
    generationTimeMs: integer("generation_time_ms"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<GenericMetadata>().default({}),
    
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxGenImagesTenant: index("idx_gen_images_tenant").on(table.tenantId),
    idxGenImagesConversation: index("idx_gen_images_conversation").on(table.conversationId),
    idxGenImagesCreatedBy: index("idx_gen_images_created_by").on(table.createdBy),
    idxGenImagesStatus: index("idx_gen_images_status").on(table.status),
    idxGenImagesApproved: index("idx_gen_images_approved").on(table.approvedForTraining),
    idxGenImagesUsed: index("idx_gen_images_used").on(table.usedInFineTuning),
  })
);

// ============================================================================
// MEDIA UPLOADS (FASE 9 - Multimodal: Imagem, Áudio, Documento)
// ATUALIZADO 23/12/2025: Removido 'video' (muito pesado para GPU)
// ============================================================================

export const mediaTypeEnum = pgEnum("media_type", [
  "image",
  "audio",
  "document",
]);

export const mediaProcessingStatusEnum = pgEnum("media_processing_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const mediaUploads = pgTable(
  "media_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
    
    // Tipo e arquivo
    mediaType: mediaTypeEnum("media_type").notNull(),
    originalFilename: varchar("original_filename", { length: 500 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    fileSize: integer("file_size").notNull(),
    filePath: text("file_path"),
    fileUrl: text("file_url"),
    thumbnailPath: text("thumbnail_path"),
    
    // Dimensões (para imagem/vídeo)
    width: integer("width"),
    height: integer("height"),
    duration: real("duration"), // Segundos (para áudio/vídeo)
    
    // Processamento
    processingStatus: mediaProcessingStatusEnum("processing_status").default("pending"),
    processingError: text("processing_error"),
    processingTimeMs: integer("processing_time_ms"),
    
    // Embeddings para RAG multimodal
    // Texto: DEPRECATED - Novos embeddings vão para Qdrant (Qwen3-Embedding-0.6B, 1024 dim)
    textEmbedding: textVector("text_embedding"),
    
    // Transcrição (para áudio/vídeo)
    transcription: text("transcription"),
    transcriptionLanguage: varchar("transcription_language", { length: 10 }),
    transcriptionConfidence: real("transcription_confidence"),
    
    // Análise de conteúdo (guardrails)
    nsfwScore: real("nsfw_score"),
    piiDetected: boolean("pii_detected").default(false),
    piiDetails: jsonb("pii_details").$type<PiiDetails>().default({ detected: false }),
    contentFlags: jsonb("content_flags").$type<ContentFlags>().default([]),
    
    // Metadata extraída (EXIF, etc.)
    extractedMetadata: jsonb("extracted_metadata").$type<ExtractedMetadata>().default({}),
    
    // Integração com LLM
    sentToLlm: boolean("sent_to_llm").default(false),
    llmDescription: text("llm_description"),
    
    // Namespace para RAG e treinamento (Plano RAG Multimodal Enterprise Fase 2 - 11/02/2026)
    namespaceId: uuid("namespace_id").references(() => namespaces.id, { onDelete: "set null" }),

    // Training
    approvedForTraining: boolean("approved_for_training").default(false),
    usedInFineTuning: boolean("used_in_fine_tuning").default(false),

    criadoEm: timestamp("criado_em").defaultNow(),
    processadoEm: timestamp("processado_em"),
  },
  (table) => ({
    idxMediaUploadsTenantConversation: index("idx_media_uploads_tenant_conversation").on(table.tenantId, table.conversationId),
    idxMediaUploadsNamespace: index("idx_media_uploads_namespace").on(table.namespaceId),
    idxMediaUploadsTenantMessage: index("idx_media_uploads_tenant_message").on(table.tenantId, table.messageId),
    idxMediaUploadsTenantUser: index("idx_media_uploads_tenant_user").on(table.tenantId, table.userId),
    idxMediaUploadsTenantType: index("idx_media_uploads_tenant_type").on(table.tenantId, table.mediaType),
    idxMediaUploadsStatus: index("idx_media_uploads_status").on(table.processingStatus),
    idxMediaUploadsCreated: index("idx_media_uploads_created").on(table.criadoEm),
    idxMediaUploadsApproved: index("idx_media_uploads_approved").on(table.approvedForTraining),
  })
);

// ============================================================================
// FEATURE FLAGS (Runtime Configuration - Enterprise)
// ============================================================================

// ============================================================================
// SYSTEM CONFIG - Configurações editáveis via UI (RAG, Chat, Treino)
// Valores em DB têm precedência sobre variáveis de ambiente.
// Ref: docs/TREINAMENTO-LIMITES-E-BOAS-PRATICAS.md
// ============================================================================
export const systemConfig = pgTable("system_config", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 100 }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    description: text("description"),
    metadata: jsonb("metadata").default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxFeatureFlagsKey: index("idx_feature_flags_key").on(table.key),
    idxFeatureFlagsTenantKey: index("idx_feature_flags_tenant_key").on(table.tenantId, table.key),
  })
);

// ============================================================================
// ASSISTANT SETTINGS (Configuração da Alice - System Prompt/Comportamento/Humor)
// ============================================================================
export const assistantSettings = pgTable(
  "assistant_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    systemPrompt: text("system_prompt"),
    creatorName: text("creator_name"),
    creatorRule: text("creator_rule"),
    ethicsPolicy: text("ethics_policy"),
    moralPolicy: text("moral_policy"),
    legalPolicy: text("legal_policy"),
    safetyGuardrails: text("safety_guardrails"),
    nsfwPolicy: text("nsfw_policy"),
    behavior: text("behavior"),
    mood: text("mood"),
    behaviorDirectness: integer("behavior_directness"),
    behaviorProactivity: integer("behavior_proactivity"),
    moodFormality: integer("mood_formality"),
    moodEmpathy: integer("mood_empathy"),
    typingSpeedMs: integer("typing_speed_ms"),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxAssistantSettingsTenant: uniqueIndex("idx_assistant_settings_tenant").on(table.tenantId),
  })
);

// ============================================================================
// AGENTIC SETTINGS (Execução agentic + links por tenant)
// ============================================================================

export interface AgenticDetectorGroup {
  keywords: string[];
  patterns: string[];
}

export interface AgenticDetectors {
  webSearch: AgenticDetectorGroup;
  deepWeb: AgenticDetectorGroup;
  webImageSearch: AgenticDetectorGroup;
  imageGeneration: AgenticDetectorGroup;
  trading: AgenticDetectorGroup;
  agentRouting: {
    manualKeywords: string[];
    autoKeywords: string[];
  };
  namespaceRouting: {
    baseKeywords: string[];
    perNamespace: Record<string, {
      keywords: string[];
      patterns: string[];
    }>;
    moduleBindings: Record<string, string[]>;
  };
  grafana: {
    baseKeywords: string[];
    listDashboardsKeywords: string[];
    updateDashboardKeywords: string[];
    getDashboardKeywords: string[];
  };
  agenticTask: {
    createKeywords: string[];
    updateKeywords: string[];
    intentKeywords: string[];
    typeKeywords: {
      document: string[];
      report: string[];
      accounting: string[];
      planning: string[];
    };
  };
  payments: {
    wiseKeywords: string[];
    wiseRecipientsKeywords: string[];
    wiseTransferKeywords: string[];
    wiseExchangeKeywords: string[];
    stripeKeywords: string[];
    stripePaymentKeywords: string[];
  };
  stackOps: {
    baseKeywords: string[];
    deployKeywords: string[];
    rollbackKeywords: string[];
    dryRunKeywords: string[];
    smartDeployKeywords: string[];
    stackKeywords: string[];
  };
}

export const agenticSettings = pgTable(
  "agentic_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
    webEnabled: boolean("web_enabled").notNull().default(true),
    observabilityReadEnabled: boolean("observability_read_enabled").notNull().default(true),
    observabilityWriteEnabled: boolean("observability_write_enabled").notNull().default(true),
    tradingEnabled: boolean("trading_enabled").notNull().default(true),
    paymentsEnabled: boolean("payments_enabled").notNull().default(true),
    stackOpsEnabled: boolean("stack_ops_enabled").notNull().default(true),
    financialApprovalRequired: boolean("financial_approval_required").notNull().default(true),
    detectors: jsonb("detectors").$type<AgenticDetectors>().notNull().default(sql`'{}'::jsonb`),
    platformLinks: jsonb("platform_links").$type<Array<{
      id: string;
      name: string;
      url: string;
      description?: string;
      tags?: string[];
    }>>().notNull().default([]),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxAgenticSettingsTenant: uniqueIndex("idx_agentic_settings_tenant").on(table.tenantId),
  })
);

// ============================================================================
// BACKUP JOBS (Regra 6 - Enterprise-Grade Persistence)
// Estado de backup persistido em PostgreSQL (NÃO in-memory)
// ============================================================================

/**
 * Tipo JSONB para componentes do backup
 * Cada componente (postgresql, redis, qdrant, uploads) tem seu status
 */
export interface BackupComponentDetail {
  component: 'postgresql' | 'redis' | 'qdrant' | 'uploads';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  durationSeconds?: number;
  size?: string;
  error?: string;
  metadata?: Record<string, string>;
}

/**
 * Tipo JSONB para manifesto do backup
 * ATUALIZADO: 05/12/2025 - Removido S3/uploads, adicionado storage local
 */
export interface BackupManifestData {
  components: {
    postgresql?: { status: string; lsn?: string; backupSet?: string; size?: string; walArchived?: boolean; };
    redis?: { status: string; rdbChecksum?: string; size?: string; };
    qdrant?: { status: string; snapshotName?: string; collections?: string[]; size?: string; };
  };
  storage: { type: 'local'; path: string; volumeName: string; };
  encryption: { enabled: boolean; algorithm?: string; };
  notes?: string;
}

export const backupJobs = pgTable(
  "backup_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: varchar("job_id", { length: 255 }).notNull().unique(),
    status: backupJobStatusEnum("status").notNull().default("queued"),
    backupType: backupTypeEnum("backup_type").notNull().default("full"),
    progress: integer("progress").notNull().default(0),
    currentComponent: varchar("current_component", { length: 50 }),
    components: jsonb("components").$type<BackupComponentDetail[]>().default([]),
    manifest: jsonb("manifest").$type<BackupManifestData>(),
    totalSize: varchar("total_size", { length: 50 }),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    estimatedCompletion: timestamp("estimated_completion"),
    completedAt: timestamp("completed_at"),
    durationSeconds: integer("duration_seconds"),
    error: text("error"),
    createdBy: varchar("created_by", { length: 255 }),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxBackupJobsJobId: index("idx_backup_jobs_job_id").on(table.jobId),
    idxBackupJobsStatus: index("idx_backup_jobs_status").on(table.status),
    idxBackupJobsType: index("idx_backup_jobs_type").on(table.backupType),
    idxBackupJobsStarted: index("idx_backup_jobs_started").on(table.startedAt),
    idxBackupJobsCreated: index("idx_backup_jobs_created").on(table.criadoEm),
  })
);

export const insertBackupJobSchema = createInsertSchema(backupJobs).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});
export type InsertBackupJob = z.infer<typeof insertBackupJobSchema>;
export type BackupJob = typeof backupJobs.$inferSelect;

// ============================================================================
// RELATIONS
// ============================================================================

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  userGroups: many(userGroups),
  namespaces: many(namespaces),
  namespaceProfiles: many(namespaceProfiles),
  agents: many(agents),
  conversations: many(conversations),
  integrations: many(integrations),
  llmConfigs: many(llmConfig),
  auditLogs: many(auditLogs),
  immutableAuditEvents: many(immutableAuditEvents),
  usageMetrics: many(usageMetrics),
  assistantSettings: many(assistantSettings),
  agenticSettings: many(agenticSettings),
}));

export const agenticSettingsRelations = relations(agenticSettings, ({ one }) => ({
  tenant: one(tenants, {
    fields: [agenticSettings.tenantId],
    references: [tenants.id],
  }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  customRole: one(customRoles, {
    fields: [users.customRoleId],
    references: [customRoles.id],
  }),
  roles: many(userRoles),
  customRoles: many(userCustomRoles),
  conversations: many(conversations),
  messages: many(messages),
  auditLogs: many(auditLogs),
  immutableAuditEvents: many(immutableAuditEvents),
  usageMetrics: many(usageMetrics),
  groupMemberships: many(userGroupMembers),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
}));

export const userCustomRolesRelations = relations(userCustomRoles, ({ one }) => ({
  user: one(users, {
    fields: [userCustomRoles.userId],
    references: [users.id],
  }),
  customRole: one(customRoles, {
    fields: [userCustomRoles.customRoleId],
    references: [customRoles.id],
  }),
}));

export const customRolesRelations = relations(customRoles, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [customRoles.tenantId],
    references: [tenants.id],
  }),
  permissions: many(customRolePermissions),
  users: many(users),
}));

export const customRolePermissionsRelations = relations(customRolePermissions, ({ one }) => ({
  customRole: one(customRoles, {
    fields: [customRolePermissions.customRoleId],
    references: [customRoles.id],
  }),
  permission: one(permissions, {
    fields: [customRolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const userGroupsRelations = relations(userGroups, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [userGroups.tenantId],
    references: [tenants.id],
  }),
  members: many(userGroupMembers),
  createdByUser: one(users, {
    fields: [userGroups.criadoPor],
    references: [users.id],
  }),
  updatedByUser: one(users, {
    fields: [userGroups.atualizadoPor],
    references: [users.id],
  }),
}));

export const userGroupMembersRelations = relations(userGroupMembers, ({ one }) => ({
  tenant: one(tenants, {
    fields: [userGroupMembers.tenantId],
    references: [tenants.id],
  }),
  group: one(userGroups, {
    fields: [userGroupMembers.groupId],
    references: [userGroups.id],
  }),
  user: one(users, {
    fields: [userGroupMembers.userId],
    references: [users.id],
  }),
  createdByUser: one(users, {
    fields: [userGroupMembers.criadoPor],
    references: [users.id],
  }),
}));

export const namespacesRelations = relations(namespaces, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [namespaces.tenantId],
    references: [tenants.id],
  }),
  profile: one(namespaceProfiles, {
    fields: [namespaces.id],
    references: [namespaceProfiles.namespaceId],
  }),
  agents: many(agents),
  conversations: many(conversations),
  documents: many(documents),
  learningTasks: many(learningTasks),
}));

export const namespaceProfilesRelations = relations(namespaceProfiles, ({ one }) => ({
  tenant: one(tenants, {
    fields: [namespaceProfiles.tenantId],
    references: [tenants.id],
  }),
  namespace: one(namespaces, {
    fields: [namespaceProfiles.namespaceId],
    references: [namespaces.id],
  }),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [agents.tenantId],
    references: [tenants.id],
  }),
  namespace: one(namespaces, {
    fields: [agents.namespaceId],
    references: [namespaces.id],
  }),
  conversations: many(conversations),
  messages: many(messages),
  learningTasks: many(learningTasks),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [conversations.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  agent: one(agents, {
    fields: [conversations.agentId],
    references: [agents.id],
  }),
  namespace: one(namespaces, {
    fields: [conversations.namespaceId],
    references: [namespaces.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  user: one(users, {
    fields: [messages.userId],
    references: [users.id],
  }),
  agent: one(agents, {
    fields: [messages.agentId],
    references: [agents.id],
  }),
}));

export const generatedImagesRelations = relations(generatedImages, ({ one }) => ({
  tenant: one(tenants, {
    fields: [generatedImages.tenantId],
    references: [tenants.id],
  }),
  conversation: one(conversations, {
    fields: [generatedImages.conversationId],
    references: [conversations.id],
  }),
  message: one(messages, {
    fields: [generatedImages.messageId],
    references: [messages.id],
  }),
  createdByUser: one(users, {
    fields: [generatedImages.createdBy],
    references: [users.id],
  }),
}));

export const mediaUploadsRelations = relations(mediaUploads, ({ one }) => ({
  tenant: one(tenants, {
    fields: [mediaUploads.tenantId],
    references: [tenants.id],
  }),
  namespace: one(namespaces, {
    fields: [mediaUploads.namespaceId],
    references: [namespaces.id],
  }),
  conversation: one(conversations, {
    fields: [mediaUploads.conversationId],
    references: [conversations.id],
  }),
  message: one(messages, {
    fields: [mediaUploads.messageId],
    references: [messages.id],
  }),
  user: one(users, {
    fields: [mediaUploads.userId],
    references: [users.id],
  }),
}));

export const assistantSettingsRelations = relations(assistantSettings, ({ one }) => ({
  tenant: one(tenants, {
    fields: [assistantSettings.tenantId],
    references: [tenants.id],
  }),
  createdByUser: one(users, {
    fields: [assistantSettings.createdBy],
    references: [users.id],
  }),
  updatedByUser: one(users, {
    fields: [assistantSettings.updatedBy],
    references: [users.id],
  }),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  namespace: one(namespaces, {
    fields: [documents.namespaceId],
    references: [namespaces.id],
  }),
  chunks: many(documentChunks),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, {
    fields: [documentChunks.documentId],
    references: [documents.id],
  }),
}));

export const learningTasksRelations = relations(learningTasks, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [learningTasks.tenantId],
    references: [tenants.id],
  }),
  agent: one(agents, {
    fields: [learningTasks.agentId],
    references: [agents.id],
  }),
  namespace: one(namespaces, {
    fields: [learningTasks.namespaceId],
    references: [namespaces.id],
  }),
  eventos: many(learningTaskEvents),
}));

export const learningTaskEventsRelations = relations(learningTaskEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [learningTaskEvents.tenantId],
    references: [tenants.id],
  }),
  task: one(learningTasks, {
    fields: [learningTaskEvents.learningTaskId],
    references: [learningTasks.id],
  }),
}));

export const webCrawlRequestsRelations = relations(webCrawlRequests, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [webCrawlRequests.tenantId],
    references: [tenants.id],
  }),
  resultados: many(webCrawlResults),
}));

export const webCrawlResultsRelations = relations(webCrawlResults, ({ one }) => ({
  tenant: one(tenants, {
    fields: [webCrawlResults.tenantId],
    references: [tenants.id],
  }),
  request: one(webCrawlRequests, {
    fields: [webCrawlResults.requestId],
    references: [webCrawlRequests.id],
  }),
}));

export const mediaJobsRelations = relations(mediaJobs, ({ one }) => ({
  tenant: one(tenants, {
    fields: [mediaJobs.tenantId],
    references: [tenants.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  tenant: one(tenants, {
    fields: [auditLogs.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

export const immutableAuditEventsRelations = relations(immutableAuditEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [immutableAuditEvents.tenantId],
    references: [tenants.id],
  }),
  actorUser: one(users, {
    fields: [immutableAuditEvents.actorUserId],
    references: [users.id],
  }),
}));

// ============================================================================
// IDENTITY PROVISIONING (Outbox Pattern - Tarefa 6)
// Sincronização Alice → Grafana
// ============================================================================

// Eventos de provisionamento (Outbox Pattern)
export const identityProvisioningEvents = pgTable('identity_provisioning_events', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  
  // Tipo de evento: user.created, user.updated, user.deleted, user.role_changed
  eventType: varchar('event_type', { length: 50 }).notNull(),
  
  // Payload JSON do evento
  payload: jsonb('payload').notNull(),
  
  // Sistema de destino: grafana
  targetSystem: varchar('target_system', { length: 50 }).notNull().default('grafana'),
  
  // Status do evento: pending, processing, completed, failed, retrying
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  
  // Número de tentativas de processamento
  retryCount: integer('retry_count').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(5),
  
  // Timestamps
  criadoEm: timestamp('criado_em').notNull().defaultNow(),
  processadoEm: timestamp('processado_em'),
  proximaTentativa: timestamp('proxima_tentativa'),
  
  // Mensagem de erro (se houver)
  errorMessage: text('error_message'),
  
  // Correlation ID para rastreamento
  correlationId: varchar('correlation_id', { length: 100 }),
  
  // Tenant para isolamento multi-tenant
  tenantId: varchar('tenant_id', { length: 100 }),
});

// Mapeamento de usuários externos (Alice ↔ Grafana)
export const externalUserMappings = pgTable('external_user_mappings', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  
  // Usuário Alice
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  // Sistema externo: grafana
  externalSystem: varchar('external_system', { length: 50 }).notNull(),
  
  // ID do usuário no sistema externo
  externalUserId: varchar('external_user_id', { length: 255 }).notNull(),
  
  // Username no sistema externo
  externalUsername: varchar('external_username', { length: 255 }),
  
  // Role mapeada no sistema externo
  externalRole: varchar('external_role', { length: 100 }),
  
  // Status: active, pending, disabled, error
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  
  // Última sincronização
  lastSyncAt: timestamp('last_sync_at'),
  
  // Timestamps
  criadoEm: timestamp('criado_em').notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  
  // Metadata adicional
  metadata: jsonb('metadata'),
}, (table) => [
  uniqueIndex('idx_external_user_mapping').on(table.userId, table.externalSystem),
]);

// Relações Identity Provisioning
export const identityProvisioningEventsRelations = relations(identityProvisioningEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [identityProvisioningEvents.tenantId],
    references: [tenants.id],
  }),
}));

export const externalUserMappingsRelations = relations(externalUserMappings, ({ one }) => ({
  user: one(users, {
    fields: [externalUserMappings.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// INSERT SCHEMAS (Zod Validation)
// ============================================================================
// NOTA: Usando z.ZodType<unknown> para resolver erro TS2742 (inferência de tipos)

export const insertTenantSchema: z.ZodType<unknown> = createInsertSchema(tenants).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertUserSchema: z.ZodType<unknown> = createInsertSchema(users).omit({
  createdAt: true,
  updatedAt: true,
});

export const insertNamespaceSchema: z.ZodType<unknown> = createInsertSchema(namespaces).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertAgentSchema: z.ZodType<unknown> = createInsertSchema(agents).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertConversationSchema: z.ZodType<unknown> = createInsertSchema(conversations).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertMessageSchema: z.ZodType<unknown> = createInsertSchema(messages).omit({
  id: true,
  criadoEm: true,
});

export const insertDocumentSchema: z.ZodType<unknown> = createInsertSchema(documents).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertIntegrationSchema: z.ZodType<unknown> = createInsertSchema(integrations).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertLlmConfigSchema: z.ZodType<unknown> = createInsertSchema(llmConfig).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertMediaUploadSchema: z.ZodType<unknown> = createInsertSchema(mediaUploads).omit({
  id: true,
  criadoEm: true,
  processadoEm: true,
});

export const insertUserGroupSchema: z.ZodType<unknown> = createInsertSchema(userGroups).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertUserGroupMemberSchema: z.ZodType<unknown> = createInsertSchema(userGroupMembers).omit({
  id: true,
  criadoEm: true,
});

// ============================================================================
// TYPES
// ============================================================================

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = typeof users.$inferInsert;

export type UserGroup = typeof userGroups.$inferSelect;
export type InsertUserGroup = z.infer<typeof insertUserGroupSchema>;
export type UserGroupMember = typeof userGroupMembers.$inferSelect;
export type InsertUserGroupMember = z.infer<typeof insertUserGroupMemberSchema>;

export type Permission = typeof permissions.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type CustomRole = typeof customRoles.$inferSelect;
export type CustomRolePermission = typeof customRolePermissions.$inferSelect;

export type OAuthClient = typeof oauthClients.$inferSelect;
export type InsertOAuthClient = typeof oauthClients.$inferInsert;
export type OAuthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect;
export type OAuthToken = typeof oauthTokens.$inferSelect;
export type OidcPayload = typeof oidcPayloads.$inferSelect;
export type InsertOidcPayload = typeof oidcPayloads.$inferInsert;
export type OidcJwk = typeof oidcJwks.$inferSelect;
export type InsertOidcJwk = typeof oidcJwks.$inferInsert;
export type SystemModule = typeof systemModules.$inferSelect;
export type InsertSystemModule = typeof systemModules.$inferInsert;
export type RoleModule = typeof roleModules.$inferSelect;
export type UserModule = typeof userModules.$inferSelect;
export type InsertUserModule = typeof userModules.$inferInsert;

export type Namespace = typeof namespaces.$inferSelect;
export type InsertNamespace = z.infer<typeof insertNamespaceSchema>;

export type Agent = typeof agents.$inferSelect;
export type InsertAgent = z.infer<typeof insertAgentSchema>;

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;

export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;

export type DocumentChunk = typeof documentChunks.$inferSelect;

export type LearningTask = typeof learningTasks.$inferSelect;
export type LearningTaskEvent = typeof learningTaskEvents.$inferSelect;
export type WebCrawlRequest = typeof webCrawlRequests.$inferSelect;
export type WebCrawlResult = typeof webCrawlResults.$inferSelect;
export type MediaJob = typeof mediaJobs.$inferSelect;

export type Integration = typeof integrations.$inferSelect;
export type InsertIntegration = z.infer<typeof insertIntegrationSchema>;

export type LlmConfig = typeof llmConfig.$inferSelect;
export type InsertLlmConfig = z.infer<typeof insertLlmConfigSchema>;

export type AuditLog = typeof auditLogs.$inferSelect;
export type ImmutableAuditEvent = typeof immutableAuditEvents.$inferSelect;
export type InsertImmutableAuditEvent = typeof immutableAuditEvents.$inferInsert;
export type UsageMetric = typeof usageMetrics.$inferSelect;

export type TrainingData = typeof trainingData.$inferSelect;
export type InsertTrainingData = typeof trainingData.$inferInsert;
export type NamespaceProfile = typeof namespaceProfiles.$inferSelect;
export type InsertNamespaceProfile = typeof namespaceProfiles.$inferInsert;
export type TrainingDatasetProfile = typeof trainingDatasetProfiles.$inferSelect;
export type InsertTrainingDatasetProfile = typeof trainingDatasetProfiles.$inferInsert;
export type TrainingScopeOverride = typeof trainingScopeOverrides.$inferSelect;
export type InsertTrainingScopeOverride = typeof trainingScopeOverrides.$inferInsert;

export type FineTuningJob = typeof fineTuningJobs.$inferSelect;
export type InsertFineTuningJob = typeof fineTuningJobs.$inferInsert;
export type FineTuningPromotionApproval = typeof fineTuningPromotionApprovals.$inferSelect;
export type InsertFineTuningPromotionApproval = typeof fineTuningPromotionApprovals.$inferInsert;

// Wise Sync Types (FASE 5.5)

// Webhook Events Types (Idempotência - Segurança Enterprise)
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type InsertWebhookEvent = typeof webhookEvents.$inferInsert;

// Stripe Mapping Types (Rastreabilidade de documentos)

// Trading Types (Gate 2 - KuCoin Futures BTC)
export type TradingSignal = typeof tradingSignals.$inferSelect;
export type InsertTradingSignal = typeof tradingSignals.$inferInsert;

export type TradingSignalScheduler = typeof tradingSignalSchedulers.$inferSelect;
export type InsertTradingSignalScheduler = typeof tradingSignalSchedulers.$inferInsert;

export type TradingAnalysisScheduler = typeof tradingAnalysisSchedulers.$inferSelect;
export type InsertTradingAnalysisScheduler = typeof tradingAnalysisSchedulers.$inferInsert;

export type TradingAnalysisProfile = typeof tradingAnalysisProfiles.$inferSelect;
export type InsertTradingAnalysisProfile = typeof tradingAnalysisProfiles.$inferInsert;

export type TradingOrder = typeof tradingOrders.$inferSelect;
export type InsertTradingOrder = typeof tradingOrders.$inferInsert;

export type TradingPosition = typeof tradingPositions.$inferSelect;
export type InsertTradingPosition = typeof tradingPositions.$inferInsert;

export type TradingRiskConfig = typeof tradingRiskConfig.$inferSelect;
export type InsertTradingRiskConfig = typeof tradingRiskConfig.$inferInsert;

export type TradingSymbolPreferences = typeof tradingSymbolPreferences.$inferSelect;
export type InsertTradingSymbolPreferences = typeof tradingSymbolPreferences.$inferInsert;

export type TradingAuditLog = typeof tradingAuditLog.$inferSelect;
export type InsertTradingAuditLog = typeof tradingAuditLog.$inferInsert;

// Trading LoRA Dataset Types (Gate 2 - LLM texto)
export type TradingMarketData = typeof tradingMarketData.$inferSelect;
export type InsertTradingMarketData = typeof tradingMarketData.$inferInsert;

export type TradingDataset = typeof tradingDataset.$inferSelect;
export type InsertTradingDataset = typeof tradingDataset.$inferInsert;

export type LoraJob = typeof loraJobs.$inferSelect;
export type InsertLoraJob = typeof loraJobs.$inferInsert;

// Takeover/Handover Types (FASE 6.5)
export type ConversationState = typeof conversationStates.$inferSelect;
export type InsertConversationState = typeof conversationStates.$inferInsert;

export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type InsertConversationParticipant = typeof conversationParticipants.$inferInsert;

export type ConversationEscalation = typeof conversationEscalations.$inferSelect;
export type InsertConversationEscalation = typeof conversationEscalations.$inferInsert;

// Generated Images Types (FASE 6.5+)
export type GeneratedImage = typeof generatedImages.$inferSelect;
export type InsertGeneratedImage = typeof generatedImages.$inferInsert;

// Model Versions Types (FASE 8)
export type ModelVersion = typeof modelVersions.$inferSelect;
export type InsertModelVersion = typeof modelVersions.$inferInsert;

// Auto-Learning Schedule Types (FASE 8)
export type AutoLearningSchedule = typeof autoLearningSchedule.$inferSelect;
export type InsertAutoLearningSchedule = typeof autoLearningSchedule.$inferInsert;

// Media Uploads Types (FASE 9)
export type MediaUpload = typeof mediaUploads.$inferSelect;
export type InsertMediaUpload = typeof mediaUploads.$inferInsert;

export const insertTrainingDataSchema: z.ZodType<unknown> = createInsertSchema(trainingData).omit({
  id: true,
  criadoEm: true,
  processedAt: true,
  processadoEm: true,
});

export const insertNamespaceProfileSchema: z.ZodType<unknown> = createInsertSchema(namespaceProfiles).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertTrainingDatasetProfileSchema: z.ZodType<unknown> = createInsertSchema(trainingDatasetProfiles).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertTrainingScopeOverrideSchema: z.ZodType<unknown> = createInsertSchema(trainingScopeOverrides).omit({
  id: true,
  createdAt: true,
});

export const insertFineTuningJobSchema: z.ZodType<unknown> = createInsertSchema(fineTuningJobs).omit({
  id: true,
  criadoEm: true,
  iniciadoEm: true,
  completadoEm: true,
});

export const insertUsageMetricSchema: z.ZodType<unknown> = createInsertSchema(usageMetrics).omit({
  id: true,
  criadoEm: true,
});

// Wise Sync Insert Schema (FASE 5.5)

// Webhook Events Insert Schema (Idempotência - Segurança Enterprise)
export const insertWebhookEventSchema: z.ZodType<unknown> = createInsertSchema(webhookEvents).omit({
  id: true,
  criadoEm: true,
  processedAt: true,
});

// Stripe Mapping Insert Schema (Rastreabilidade)

// Trading Insert Schemas (Gate 2 - KuCoin Futures BTC)
export const insertTradingSignalSchema: z.ZodType<unknown> = createInsertSchema(tradingSignals).omit({
  id: true,
  criadoEm: true,
  executedAt: true,
  executedOrderId: true,
});

export const insertTradingSignalSchedulerSchema: z.ZodType<unknown> = createInsertSchema(tradingSignalSchedulers).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
  lastRunAt: true,
  nextRunAt: true,
  lastSuccessAt: true,
  lastSignalId: true,
  lastDurationMs: true,
});

export const insertTradingAnalysisSchedulerSchema: z.ZodType<unknown> = createInsertSchema(tradingAnalysisSchedulers).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
  lastRunAt: true,
  nextRunAt: true,
  lastSuccessAt: true,
  lastIndicatorId: true,
  lastDurationMs: true,
});

export const insertTradingAnalysisProfileSchema: z.ZodType<unknown> = createInsertSchema(tradingAnalysisProfiles).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertTradingOrderSchema: z.ZodType<unknown> = createInsertSchema(tradingOrders).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
  submittedAt: true,
  filledAt: true,
  cancelledAt: true,
});

export const insertTradingPositionSchema: z.ZodType<unknown> = createInsertSchema(tradingPositions).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
  openedAt: true,
  closedAt: true,
});

export const insertTradingRiskConfigSchema: z.ZodType<unknown> = createInsertSchema(tradingRiskConfig).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
  dailyPnl: true,
  dailyTradeCount: true,
  lastResetDate: true,
});

export const insertTradingNewsPresetSchema: z.ZodType<unknown> = createInsertSchema(tradingNewsPresets).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertTradingAuditLogSchema: z.ZodType<unknown> = createInsertSchema(tradingAuditLog).omit({
  id: true,
  criadoEm: true,
});

// Trading LoRA Dataset Insert Schemas (Gate 2 - LLM texto)
export const insertTradingMarketDataSchema: z.ZodType<unknown> = createInsertSchema(tradingMarketData).omit({
  id: true,
  criadoEm: true,
});

export const insertTradingDatasetSchema: z.ZodType<unknown> = createInsertSchema(tradingDataset).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertLoraJobSchema: z.ZodType<unknown> = createInsertSchema(loraJobs).omit({
  id: true,
  criadoEm: true,
  queuedAt: true,
  startedAt: true,
  completedAt: true,
});

// Takeover/Handover Insert Schemas (FASE 6.5)
export const insertConversationStateSchema: z.ZodType<unknown> = createInsertSchema(conversationStates).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

export const insertConversationParticipantSchema: z.ZodType<unknown> = createInsertSchema(conversationParticipants).omit({
  id: true,
});

export const insertConversationEscalationSchema: z.ZodType<unknown> = createInsertSchema(conversationEscalations).omit({
  id: true,
  criadoEm: true,
});

// Generated Images Insert Schema (FASE 6.5+)
export const insertGeneratedImageSchema: z.ZodType<unknown> = createInsertSchema(generatedImages).omit({
  id: true,
  criadoEm: true,
});

// Feature Flags Types (Runtime Configuration - Enterprise)
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type InsertFeatureFlag = typeof featureFlags.$inferInsert;

export const insertFeatureFlagSchema = createInsertSchema(featureFlags).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

// Identity Provisioning Types (Outbox Pattern - Tarefa 6)
export type IdentityProvisioningEvent = typeof identityProvisioningEvents.$inferSelect;
export type InsertIdentityProvisioningEvent = typeof identityProvisioningEvents.$inferInsert;

export type ExternalUserMapping = typeof externalUserMappings.$inferSelect;
export type InsertExternalUserMapping = typeof externalUserMappings.$inferInsert;

export const insertIdentityProvisioningEventSchema: z.ZodType<unknown> = createInsertSchema(identityProvisioningEvents).omit({
  id: true,
  criadoEm: true,
  processadoEm: true,
});

export const insertExternalUserMappingSchema: z.ZodType<unknown> = createInsertSchema(externalUserMappings).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});

