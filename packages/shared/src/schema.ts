import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uuid,
  real,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
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
export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "image",
  "audio",
  "video",
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
// ============================================================================
// SESSÕES (Replit Auth - OBRIGATÓRIO)
// ============================================================================
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => ({
    IDX_session_expire: index("IDX_session_expire").on(table.expire),
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
  configuracoes: jsonb("configuracoes").default({}),
  ativo: boolean("ativo").default(true),
  criadoEm: timestamp("criado_em").defaultNow(),
  atualizadoEm: timestamp("atualizado_em").defaultNow(),
});
// ============================================================================
// USUÁRIOS (Replit Auth - OBRIGATÓRIO)
// ============================================================================
export const users = pgTable(
  "users",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    email: varchar("email", { length: 255 }).unique(),
    firstName: varchar("first_name", { length: 100 }),
    lastName: varchar("last_name", { length: 100 }),
    profileImageUrl: text("profile_image_url"),
    role: userRoleEnum("role").default("viewer"),
    cargo: varchar("cargo", { length: 100 }),
    departamento: varchar("departamento", { length: 100 }),
    telefone: varchar("telefone", { length: 20 }),
    idioma: varchar("idioma", { length: 10 }).default("pt-BR"),
    timezone: varchar("timezone", { length: 50 }).default("Europe/Lisbon"),
    preferencias: jsonb("preferencias").default({}),
    ultimoAcesso: timestamp("ultimo_acesso"),
    ativo: boolean("ativo").default(true),
    // Autenticação Enterprise (OAuth + SAML + Local)
    passwordHash: text("password_hash"),
    googleId: varchar("google_id", { length: 255 }),
    githubId: varchar("github_id", { length: 255 }),
    microsoftId: varchar("microsoft_id", { length: 255 }),
    samlNameId: varchar("saml_name_id", { length: 500 }),
    authProvider: varchar("auth_provider", { length: 50 }).default("local"),
    emailVerified: boolean("email_verified").default(false),
    // Stripe (Blueprint: stripe integration)
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    idx_users_tenant: index("idx_users_tenant").on(table.tenantId),
    idx_users_email: index("idx_users_email").on(table.email),
    idx_users_role: index("idx_users_role").on(table.role),
    idx_users_google: index("idx_users_google").on(table.googleId),
    idx_users_github: index("idx_users_github").on(table.githubId),
    idx_users_microsoft: index("idx_users_microsoft").on(table.microsoftId),
    idx_users_saml: index("idx_users_saml").on(table.samlNameId),
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
    idx_role_permissions_role: index("idx_role_permissions_role").on(table.role),
    idx_role_permissions_permission: index("idx_role_permissions_permission").on(table.permissionId),
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
    configuracoes: jsonb("configuracoes").default({}),
    ordem: integer("ordem").default(0),
    ativo: boolean("ativo").default(true),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idx_namespaces_tenant: index("idx_namespaces_tenant").on(table.tenantId),
    idx_namespaces_slug: index("idx_namespaces_slug").on(table.slug),
  })
);
// ============================================================================
// AGENTES (Agentes de IA Especializados)
// ============================================================================
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    namespaceId: uuid("namespace_id").references(() => namespaces.id, {
      onDelete: "cascade",
    }),
    nome: varchar("nome", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    descricao: text("descricao"),
    avatar: text("avatar"),
    personalidade: text("personalidade"),
    instrucoes: text("instrucoes"),
    capacidades: text("capacidades").array(),
    modeloBase: varchar("modelo_base", { length: 100 }).default("llama4-maverick"),
    temperaturaModelo: real("temperatura_modelo").default(0.7),
    maxTokens: integer("max_tokens").default(4096),
    status: agentStatusEnum("status").default("active"),
    metricas: jsonb("metricas").default({}),
    versao: integer("versao").default(1),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idx_agents_namespace: index("idx_agents_namespace").on(table.namespaceId),
    idx_agents_status: index("idx_agents_status").on(table.status),
  })
);
// ============================================================================
// CONVERSAS
// ============================================================================
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id").references(() => users.id),
    agentId: uuid("agent_id").references(() => agents.id),
    namespaceId: uuid("namespace_id").references(() => namespaces.id),
    titulo: varchar("titulo", { length: 500 }),
    resumo: text("resumo"),
    status: conversationStatusEnum("status").default("active"),
    isPublic: boolean("is_public").default(false),
    metadata: jsonb("metadata").default({}),
    totalMensagens: integer("total_mensagens").default(0),
    ultimaMensagemEm: timestamp("ultima_mensagem_em"),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idx_conversations_user: index("idx_conversations_user").on(table.userId),
    idx_conversations_agent: index("idx_conversations_agent").on(table.agentId),
    idx_conversations_namespace: index("idx_conversations_namespace").on(table.namespaceId),
    idx_conversations_status: index("idx_conversations_status").on(table.status),
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
    userId: varchar("user_id").references(() => users.id),
    agentId: uuid("agent_id").references(() => agents.id),
    tipo: messageTypeEnum("tipo").default("text"),
    conteudo: text("conteudo"),
    anexos: jsonb("anexos").default([]),
    metadata: jsonb("metadata").default({}),
    tokensUsados: integer("tokens_usados"),
    latenciaMs: integer("latencia_ms"),
    isFromUser: boolean("is_from_user").default(true),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idx_messages_conversation: index("idx_messages_conversation").on(table.conversationId),
    idx_messages_user: index("idx_messages_user").on(table.userId),
    idx_messages_created: index("idx_messages_created").on(table.criadoEm),
  })
);
// ============================================================================
// DOCUMENTOS (Base de Conhecimento para RAG)
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
    embedding: real("embedding").array(),
    metadata: jsonb("metadata").default({}),
    processado: boolean("processado").default(false),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idx_documents_namespace: index("idx_documents_namespace").on(table.namespaceId),
    idx_documents_hash: index("idx_documents_hash").on(table.hashConteudo),
    idx_documents_semhash: index("idx_documents_semhash").on(table.semhash),
  })
);
// ============================================================================
// CHUNKS DE DOCUMENTOS (Para RAG)
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
    embedding: real("embedding").array(),
    metadata: jsonb("metadata").default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idx_chunks_document: index("idx_chunks_document").on(table.documentId),
    idx_chunks_position: index("idx_chunks_position").on(table.posicao),
  })
);
// ============================================================================
// TAREFAS DE APRENDIZADO (Fine-tuning, Treinamento)
// ============================================================================
export const learningTasks = pgTable(
  "learning_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tipo: varchar("tipo", { length: 50 }).notNull(),
    status: taskStatusEnum("status").default("pending"),
    agentId: uuid("agent_id").references(() => agents.id),
    namespaceId: uuid("namespace_id").references(() => namespaces.id),
    parametros: jsonb("parametros").default({}),
    resultado: jsonb("resultado"),
    erro: text("erro"),
    progresso: integer("progresso").default(0),
    iniciadoEm: timestamp("iniciado_em"),
    finalizadoEm: timestamp("finalizado_em"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idx_learning_tasks_status: index("idx_learning_tasks_status").on(table.status),
    idx_learning_tasks_agent: index("idx_learning_tasks_agent").on(table.agentId),
  })
);
// ============================================================================
// INTEGRAÇÕES EXTERNAS (ERPNext, Stripe, Twilio, etc.)
// ============================================================================
export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    tipo: varchar("tipo", { length: 50 }).notNull(),
    nome: varchar("nome", { length: 255 }).notNull(),
    configuracao: jsonb("configuracao").default({}),
    credenciais: jsonb("credenciais").default({}),
    webhookUrl: text("webhook_url"),
    ultimaSincronizacao: timestamp("ultima_sincronizacao"),
    ativo: boolean("ativo").default(true),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idx_integrations_tenant: index("idx_integrations_tenant").on(table.tenantId),
    idx_integrations_tipo: index("idx_integrations_tipo").on(table.tipo),
  })
);
// ============================================================================
// CONFIGURAÇÕES DO MODELO LLM (Llama 4 Maverick - Self-hosted)
// ============================================================================
export const llmConfig = pgTable("llm_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  modelo: varchar("modelo", { length: 100 }).notNull().default("llama4-maverick"),
  endpoint: text("endpoint").notNull(),
  apiKey: text("api_key"),
  maxTokens: integer("max_tokens").default(4096),
  temperatura: real("temperatura").default(0.7),
  topP: real("top_p").default(0.9),
  configuracaoAvancada: jsonb("configuracao_avancada").default({}),
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
    userId: varchar("user_id").references(() => users.id),
    acao: varchar("acao", { length: 100 }).notNull(),
    recurso: varchar("recurso", { length: 100 }).notNull(),
    recursoId: varchar("recurso_id", { length: 255 }),
    detalhes: jsonb("detalhes").default({}),
    ip: varchar("ip", { length: 45 }),
    userAgent: text("user_agent"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idx_audit_tenant: index("idx_audit_tenant").on(table.tenantId),
    idx_audit_user: index("idx_audit_user").on(table.userId),
    idx_audit_acao: index("idx_audit_acao").on(table.acao),
    idx_audit_created: index("idx_audit_created").on(table.criadoEm),
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
    userId: varchar("user_id").references(() => users.id),
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
    idx_usage_tenant: index("idx_usage_tenant").on(table.tenantId),
    idx_usage_user: index("idx_usage_user").on(table.userId),
    idx_usage_data: index("idx_usage_data").on(table.data),
    idx_usage_type: index("idx_usage_type").on(table.type),
  })
);
// ============================================================================
// DADOS DE TREINAMENTO (Auto-evolução)
// ============================================================================
export const trainingDataStatusEnum = pgEnum("training_data_status", [
  "pending",
  "approved",
  "rejected",
  "used",
]);
export const trainingData = pgTable(
  "training_data",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    namespaceId: uuid("namespace_id").references(() => namespaces.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    source: varchar("source", { length: 50 }).notNull(),
    messages: jsonb("messages").notNull(),
    rating: integer("rating"),
    status: trainingDataStatusEnum("status").default("pending"),
    semhash: varchar("semhash", { length: 64 }),
    embedding: real("embedding").array(),
    isDuplicate: boolean("is_duplicate").default(false),
    duplicateOfId: uuid("duplicate_of_id"),
    similarityScore: real("similarity_score"),
    usedInJobId: varchar("used_in_job_id", { length: 255 }),
    criadoEm: timestamp("criado_em").defaultNow(),
    processadoEm: timestamp("processado_em"),
  },
  (table) => ({
    idx_training_tenant: index("idx_training_tenant").on(table.tenantId),
    idx_training_namespace: index("idx_training_namespace").on(table.namespaceId),
    idx_training_status: index("idx_training_status").on(table.status),
    idx_training_semhash: index("idx_training_semhash").on(table.semhash),
    idx_training_source: index("idx_training_source").on(table.source),
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
export const fineTuningJobs = pgTable(
  "fine_tuning_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    name: varchar("name", { length: 255 }).notNull(),
    baseModel: varchar("base_model", { length: 100 }).notNull(),
    status: fineTuningJobStatusEnum("status").default("pending"),
    progress: integer("progress").default(0),
    containerGroupId: varchar("container_group_id", { length: 255 }),
    trainingDataCount: integer("training_data_count").default(0),
    validationDataCount: integer("validation_data_count").default(0),
    hyperparameters: jsonb("hyperparameters").default({}),
    metrics: jsonb("metrics").default({}),
    resultModel: varchar("result_model", { length: 255 }),
    errorMessage: text("error_message"),
    iniciadoEm: timestamp("iniciado_em"),
    completadoEm: timestamp("completado_em"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idx_finetuning_tenant: index("idx_finetuning_tenant").on(table.tenantId),
    idx_finetuning_status: index("idx_finetuning_status").on(table.status),
  })
);
// ============================================================================
// RELATIONS
// ============================================================================
export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  namespaces: many(namespaces),
  integrations: many(integrations),
  llmConfigs: many(llmConfig),
  auditLogs: many(auditLogs),
  usageMetrics: many(usageMetrics),
}));
export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  conversations: many(conversations),
  messages: many(messages),
  auditLogs: many(auditLogs),
  usageMetrics: many(usageMetrics),
}));
export const namespacesRelations = relations(namespaces, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [namespaces.tenantId],
    references: [tenants.id],
  }),
  agents: many(agents),
  conversations: many(conversations),
  documents: many(documents),
  learningTasks: many(learningTasks),
}));
export const agentsRelations = relations(agents, ({ one, many }) => ({
  namespace: one(namespaces, {
    fields: [agents.namespaceId],
    references: [namespaces.id],
  }),
  conversations: many(conversations),
  messages: many(messages),
  learningTasks: many(learningTasks),
}));
export const conversationsRelations = relations(conversations, ({ one, many }) => ({
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
export const usageMetricsRelations = relations(usageMetrics, ({ one }) => ({
  tenant: one(tenants, {
    fields: [usageMetrics.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [usageMetrics.userId],
    references: [users.id],
  }),
}));
// ============================================================================
// INSERT SCHEMAS (Zod Validation)
// ============================================================================
const _insertTenantSchema = createInsertSchema(tenants);
export const insertTenantSchema: z.ZodObject<z.ZodRawShape> = _insertTenantSchema.omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
}) as unknown as z.ZodObject<z.ZodRawShape>;
const _insertUserSchema = createInsertSchema(users);
export const insertUserSchema: z.ZodObject<z.ZodRawShape> = _insertUserSchema.omit({
  createdAt: true,
  updatedAt: true,
}) as unknown as z.ZodObject<z.ZodRawShape>;
const _insertNamespaceSchema = createInsertSchema(namespaces);
export const insertNamespaceSchema: z.ZodObject<z.ZodRawShape> = _insertNamespaceSchema.omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
}) as unknown as z.ZodObject<z.ZodRawShape>;
const _insertAgentSchema = createInsertSchema(agents);
export const insertAgentSchema: z.ZodObject<z.ZodRawShape> = _insertAgentSchema.omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
}) as unknown as z.ZodObject<z.ZodRawShape>;
const _insertConversationSchema = createInsertSchema(conversations);
export const insertConversationSchema: z.ZodObject<z.ZodRawShape> = _insertConversationSchema.omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
}) as unknown as z.ZodObject<z.ZodRawShape>;
const _insertMessageSchema = createInsertSchema(messages);
export const insertMessageSchema: z.ZodObject<z.ZodRawShape> = _insertMessageSchema.omit({
  id: true,
  criadoEm: true,
}) as unknown as z.ZodObject<z.ZodRawShape>;
const _insertDocumentSchema = createInsertSchema(documents);
export const insertDocumentSchema: z.ZodObject<z.ZodRawShape> = _insertDocumentSchema.omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
}) as unknown as z.ZodObject<z.ZodRawShape>;
const _insertIntegrationSchema = createInsertSchema(integrations);
export const insertIntegrationSchema: z.ZodObject<z.ZodRawShape> = _insertIntegrationSchema.omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
}) as unknown as z.ZodObject<z.ZodRawShape>;
const _insertLlmConfigSchema = createInsertSchema(llmConfig);
export const insertLlmConfigSchema: z.ZodObject<z.ZodRawShape> = _insertLlmConfigSchema.omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
}) as unknown as z.ZodObject<z.ZodRawShape>;
// ============================================================================
// TYPES
// ============================================================================
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = typeof users.$inferInsert;
export type Permission = typeof permissions.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;
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
export type Integration = typeof integrations.$inferSelect;
export type InsertIntegration = z.infer<typeof insertIntegrationSchema>;
export type LlmConfig = typeof llmConfig.$inferSelect;
export type InsertLlmConfig = z.infer<typeof insertLlmConfigSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type UsageMetric = typeof usageMetrics.$inferSelect;
export type TrainingData = typeof trainingData.$inferSelect;
export type InsertTrainingData = typeof trainingData.$inferInsert;
export type FineTuningJob = typeof fineTuningJobs.$inferSelect;
export type InsertFineTuningJob = typeof fineTuningJobs.$inferInsert;
const _insertTrainingDataSchema = createInsertSchema(trainingData);
export const insertTrainingDataSchema: z.ZodObject<z.ZodRawShape> = _insertTrainingDataSchema.omit({
  id: true,
  criadoEm: true,
  processadoEm: true,
}) as unknown as z.ZodObject<z.ZodRawShape>;
const _insertFineTuningJobSchema = createInsertSchema(fineTuningJobs);
export const insertFineTuningJobSchema: z.ZodObject<z.ZodRawShape> = _insertFineTuningJobSchema.omit({
  id: true,
  criadoEm: true,
  iniciadoEm: true,
  completadoEm: true,
}) as unknown as z.ZodObject<z.ZodRawShape>;
const _insertUsageMetricSchema = createInsertSchema(usageMetrics);
export const insertUsageMetricSchema: z.ZodObject<z.ZodRawShape> = _insertUsageMetricSchema.omit({
  id: true,
  criadoEm: true,
}) as unknown as z.ZodObject<z.ZodRawShape>;
