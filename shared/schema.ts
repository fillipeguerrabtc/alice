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
// SESSÕES (PostgreSQL Sessions - OBRIGATÓRIO)
// ============================================================================

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
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
  configuracoes: jsonb("configuracoes").default({}),
  ativo: boolean("ativo").default(true),
  criadoEm: timestamp("criado_em").defaultNow(),
  atualizadoEm: timestamp("atualizado_em").defaultNow(),
});

// ============================================================================
// USUÁRIOS (Autenticação Unificada: OAuth + SAML + Local)
// Compatível com: Cursor IDE (DEV) e Hetzner Cloud (PROD)
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

// ============================================================================
// OAUTH CLIENTS (SSO - Alice como OAuth Provider para Grafana/ERPNext)
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
    userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
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
    userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
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

export type OAuthClient = typeof oauthClients.$inferSelect;
export type InsertOAuthClient = typeof oauthClients.$inferInsert;
export type OAuthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect;
export type InsertOAuthAuthorizationCode = typeof oauthAuthorizationCodes.$inferInsert;
export type OAuthToken = typeof oauthTokens.$inferSelect;
export type InsertOAuthToken = typeof oauthTokens.$inferInsert;

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

export type OidcPayload = typeof oidcPayloads.$inferSelect;
export type InsertOidcPayload = typeof oidcPayloads.$inferInsert;

// ============================================================================
// OIDC JWKS (Chaves RS256 para assinatura de tokens - Persistência PostgreSQL)
// Seguindo Regra 6 CLAUDE.md: PROIBIDO in-memory storage
// ============================================================================

export const oidcJwks = pgTable(
  "oidc_jwks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kid: varchar("kid", { length: 255 }).notNull().unique(),
    alg: varchar("alg", { length: 10 }).notNull().default("RS256"),
    use: varchar("use", { length: 10 }).notNull().default("sig"),
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

export type OidcJwk = typeof oidcJwks.$inferSelect;
export type InsertOidcJwk = typeof oidcJwks.$inferInsert;

// ============================================================================
// IDENTITY PROVISIONING EVENTS (Outbox Pattern - Sincronização Alice → Grafana/ERPNext)
// Seguindo Regra 6 CLAUDE.md: Persistência PostgreSQL para garantia de entrega
// ============================================================================

export const identityProvisioningStatusEnum = pgEnum("identity_provisioning_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  "retrying",
]);

export const identityProvisioningEvents = pgTable(
  "identity_provisioning_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    payload: jsonb("payload").notNull(),
    targetSystem: varchar("target_system", { length: 50 }).notNull().default("all"),
    correlationId: varchar("correlation_id", { length: 255 }),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    status: identityProvisioningStatusEnum("status").default("pending"),
    retryCount: integer("retry_count").default(0),
    maxRetries: integer("max_retries").default(5),
    errorMessage: text("error_message"),
    proximaTentativa: timestamp("proxima_tentativa"),
    processadoEm: timestamp("processado_em"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxProvisioningStatus: index("idx_provisioning_status").on(table.status),
    idxProvisioningEventType: index("idx_provisioning_event_type").on(table.eventType),
    idxProvisioningTarget: index("idx_provisioning_target").on(table.targetSystem),
    idxProvisioningTenant: index("idx_provisioning_tenant").on(table.tenantId),
    idxProvisioningCreated: index("idx_provisioning_created").on(table.criadoEm),
  })
);

export type IdentityProvisioningEvent = typeof identityProvisioningEvents.$inferSelect;
export type InsertIdentityProvisioningEvent = typeof identityProvisioningEvents.$inferInsert;

// ============================================================================
// EXTERNAL USER MAPPINGS (Mapeamento Alice ↔ Grafana/ERPNext)
// Rastreamento de usuários sincronizados com sistemas externos
// ============================================================================

export const externalUserMappings = pgTable(
  "external_user_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    externalSystem: varchar("external_system", { length: 50 }).notNull(),
    externalUserId: varchar("external_user_id", { length: 255 }).notNull(),
    externalUsername: varchar("external_username", { length: 255 }),
    externalRole: varchar("external_role", { length: 100 }),
    status: varchar("status", { length: 20 }).default("active"),
    lastSyncAt: timestamp("last_sync_at"),
    metadata: jsonb("metadata").default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxExternalMappingsUser: index("idx_external_mappings_user").on(table.userId),
    idxExternalMappingsSystem: index("idx_external_mappings_system").on(table.externalSystem),
    idxExternalMappingsExternal: index("idx_external_mappings_external").on(table.externalUserId),
    uniqueUserSystem: index("unique_user_system").on(table.userId, table.externalSystem),
  })
);

export type ExternalUserMapping = typeof externalUserMappings.$inferSelect;
export type InsertExternalUserMapping = typeof externalUserMappings.$inferInsert;

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
    userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    moduleId: uuid("module_id").references(() => systemModules.id, { onDelete: "cascade" }).notNull(),
    permitido: boolean("permitido").notNull(),
    acessoLeitura: boolean("acesso_leitura").default(true),
    acessoEscrita: boolean("acesso_escrita").default(false),
    acessoAdmin: boolean("acesso_admin").default(false),
    criadoPor: varchar("criado_por").references(() => users.id),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxUserModulesUser: index("idx_user_modules_user").on(table.userId),
    idxUserModulesModule: index("idx_user_modules_module").on(table.moduleId),
    uniqueUserModule: index("unique_user_module").on(table.userId, table.moduleId),
  })
);

export type SystemModule = typeof systemModules.$inferSelect;
export type InsertSystemModule = typeof systemModules.$inferInsert;
export type RoleModule = typeof roleModules.$inferSelect;
export type InsertRoleModule = typeof roleModules.$inferInsert;
export type UserModule = typeof userModules.$inferSelect;
export type InsertUserModule = typeof userModules.$inferInsert;

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
    idxNamespacesTenant: index("idx_namespaces_tenant").on(table.tenantId),
    idxNamespacesSlug: index("idx_namespaces_slug").on(table.slug),
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
    modeloBase: varchar("modelo_base", { length: 100 }).default("Mixtral-8x7B"),
    temperaturaModelo: real("temperatura_modelo").default(0.7),
    maxTokens: integer("max_tokens").default(4096),
    status: agentStatusEnum("status").default("active"),
    metricas: jsonb("metricas").default({}),
    versao: integer("versao").default(1),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxAgentsNamespace: index("idx_agents_namespace").on(table.namespaceId),
    idxAgentsStatus: index("idx_agents_status").on(table.status),
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
    idxMessagesConversation: index("idx_messages_conversation").on(table.conversationId),
    idxMessagesUser: index("idx_messages_user").on(table.userId),
    idxMessagesCreated: index("idx_messages_created").on(table.criadoEm),
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
    idxDocumentsNamespace: index("idx_documents_namespace").on(table.namespaceId),
    idxDocumentsHash: index("idx_documents_hash").on(table.hashConteudo),
    idxDocumentsSemhash: index("idx_documents_semhash").on(table.semhash),
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
    idxLearningTasksStatus: index("idx_learning_tasks_status").on(table.status),
    idxLearningTasksAgent: index("idx_learning_tasks_agent").on(table.agentId),
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
    idxIntegrationsTenant: index("idx_integrations_tenant").on(table.tenantId),
    idxIntegrationsTipo: index("idx_integrations_tipo").on(table.tipo),
  })
);

// ============================================================================
// CONFIGURAÇÕES DO MODELO LLM (Mixtral 8x7B - Salad Cloud GPU)
// ============================================================================

export const llmConfig = pgTable("llm_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  modelo: varchar("modelo", { length: 100 }).notNull().default("Mixtral-8x7B"),
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
    idxAuditTenant: index("idx_audit_tenant").on(table.tenantId),
    idxAuditUser: index("idx_audit_user").on(table.userId),
    idxAuditAcao: index("idx_audit_acao").on(table.acao),
    idxAuditCreated: index("idx_audit_created").on(table.criadoEm),
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
    idxUsageTenant: index("idx_usage_tenant").on(table.tenantId),
    idxUsageUser: index("idx_usage_user").on(table.userId),
    idxUsageData: index("idx_usage_data").on(table.data),
    idxUsageType: index("idx_usage_type").on(table.type),
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
    idxTrainingTenant: index("idx_training_tenant").on(table.tenantId),
    idxTrainingNamespace: index("idx_training_namespace").on(table.namespaceId),
    idxTrainingStatus: index("idx_training_status").on(table.status),
    idxTrainingSemhash: index("idx_training_semhash").on(table.semhash),
    idxTrainingSource: index("idx_training_source").on(table.source),
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
    idxFinetuningTenant: index("idx_finetuning_tenant").on(table.tenantId),
    idxFinetuningStatus: index("idx_finetuning_status").on(table.status),
  })
);

// ============================================================================
// WISE-ERPNEXT SYNC LOG (FASE 5.5 - Reconciliação e Auditoria)
// ============================================================================

export const wiseSyncStatusEnum = pgEnum("wise_sync_status", [
  "pending",
  "synced",
  "failed",
  "retrying",
  "manual_review",
]);

export const wiseSyncLog = pgTable(
  "wise_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    wiseTransferId: varchar("wise_transfer_id", { length: 255 }).notNull(),
    erpnextPaymentId: varchar("erpnext_payment_id", { length: 255 }),
    status: wiseSyncStatusEnum("status").default("pending"),
    wiseAmount: real("wise_amount"),
    wiseCurrency: varchar("wise_currency", { length: 3 }),
    erpnextAmount: real("erpnext_amount"),
    erpnextCurrency: varchar("erpnext_currency", { length: 3 }),
    amountDivergence: real("amount_divergence"),
    syncAttempts: integer("sync_attempts").default(0),
    lastSyncAttempt: timestamp("last_sync_attempt"),
    lastError: text("last_error"),
    metadata: jsonb("metadata").default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
    sincronizadoEm: timestamp("sincronizado_em"),
  },
  (table) => ({
    idxWiseSyncTenant: index("idx_wise_sync_tenant").on(table.tenantId),
    idxWiseSyncTransfer: index("idx_wise_sync_transfer").on(table.wiseTransferId),
    idxWiseSyncStatus: index("idx_wise_sync_status").on(table.status),
    idxWiseSyncErpnext: index("idx_wise_sync_erpnext").on(table.erpnextPaymentId),
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
  "erpnext",
]);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    source: webhookSourceEnum("source").notNull(),
    eventId: varchar("event_id", { length: 255 }).notNull(), // ID único do evento (ex: evt_xxx do Stripe)
    eventType: varchar("event_type", { length: 255 }).notNull(), // ex: checkout.session.completed
    processed: boolean("processed").default(false),
    processedAt: timestamp("processed_at"),
    payload: jsonb("payload").default({}),
    result: jsonb("result").default({}),
    error: text("error"),
    retryCount: integer("retry_count").default(0),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    // Índice único para garantir idempotência por source+eventId
    idxWebhookEventsUnique: index("idx_webhook_events_unique").on(table.source, table.eventId),
    idxWebhookEventsTenant: index("idx_webhook_events_tenant").on(table.tenantId),
    idxWebhookEventsSource: index("idx_webhook_events_source").on(table.source),
    idxWebhookEventsProcessed: index("idx_webhook_events_processed").on(table.processed),
    idxWebhookEventsCreated: index("idx_webhook_events_created").on(table.criadoEm),
  })
);

// ============================================================================
// STRIPE-ERPNEXT MAPPING (Rastreabilidade de documentos entre sistemas)
// Permite encontrar documentos ERPNext a partir de IDs Stripe
// ============================================================================

export const stripeErpnextMapping = pgTable(
  "stripe_erpnext_mapping",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    stripeSessionId: varchar("stripe_session_id", { length: 255 }).notNull(),
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
    stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
    erpnextCustomer: varchar("erpnext_customer", { length: 255 }),
    erpnextSalesOrder: varchar("erpnext_sales_order", { length: 255 }),
    erpnextSalesInvoice: varchar("erpnext_sales_invoice", { length: 255 }),
    erpnextPaymentEntry: varchar("erpnext_payment_entry", { length: 255 }),
    flowStatus: varchar("flow_status", { length: 50 }).default("pending"), // pending, order_created, invoice_created, payment_created, complete
    metadata: jsonb("metadata").default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    // Índice único por session_id para busca rápida
    idxStripeSession: index("idx_stripe_erpnext_session").on(table.stripeSessionId),
    idxStripePaymentIntent: index("idx_stripe_erpnext_payment_intent").on(table.stripePaymentIntentId),
    idxStripeCustomer: index("idx_stripe_erpnext_customer").on(table.stripeCustomerId),
    idxStripeFlowStatus: index("idx_stripe_erpnext_flow_status").on(table.flowStatus),
  })
);

// ============================================================================
// TAKEOVER/HANDOVER (FASE 6.5 - Controle de Conversas Humano/IA)
// ============================================================================

export const conversationControlModeEnum = pgEnum("conversation_control_mode", [
  "bot",           // Alice está respondendo
  "human",         // Agente humano assumiu (takeover)
  "pending_handoff", // Aguardando agente humano
  "hybrid",        // Modo híbrido (sugestões IA + aprovação humana)
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
    assignedAgentId: varchar("assigned_agent_id").references(() => users.id),
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
    metadata: jsonb("metadata").default({}),
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
    userId: varchar("user_id").references(() => users.id),
    role: varchar("role", { length: 50 }).notNull(), // customer, agent, supervisor
    joinedAt: timestamp("joined_at").defaultNow(),
    leftAt: timestamp("left_at"),
    isActive: boolean("is_active").default(true),
    metadata: jsonb("metadata").default({}),
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
    requestedBy: varchar("requested_by").references(() => users.id),
    handledBy: varchar("handled_by").references(() => users.id),
    confidenceAtEscalation: real("confidence_at_escalation"),
    sentimentAtEscalation: real("sentiment_at_escalation"),
    fallbackCountAtEscalation: integer("fallback_count_at_escalation"),
    triggerDetails: jsonb("trigger_details").default({}),
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
    name: varchar("name", { length: 255 }).notNull(),
    version: integer("version").notNull().default(1),
    baseModel: varchar("base_model", { length: 100 }).notNull().default("Mixtral-8x7B"),
    loraPath: text("lora_path"),
    status: modelVersionStatusEnum("status").default("training"),
    fineTuningJobId: uuid("fine_tuning_job_id").references(() => fineTuningJobs.id),
    trainingDataCount: integer("training_data_count").default(0),
    imageDataCount: integer("image_data_count").default(0),
    metrics: jsonb("metrics").default({}),
    baselineMetrics: jsonb("baseline_metrics").default({}),
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
    dataCollected: integer("data_collected").default(0),
    imagesCollected: integer("images_collected").default(0),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxAutoLearningTenant: index("idx_auto_learning_tenant").on(table.tenantId),
    idxAutoLearningStatus: index("idx_auto_learning_status").on(table.status),
    idxAutoLearningScheduled: index("idx_auto_learning_scheduled").on(table.scheduledFor),
  })
);

// ============================================================================
// GENERATED IMAGES (FASE 6.5+ - FLUX.1 Schnell Self-Hosted)
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
    createdBy: varchar("created_by").references(() => users.id),
    
    // Parâmetros de geração
    prompt: text("prompt").notNull(),
    negativePrompt: text("negative_prompt"),
    model: varchar("model", { length: 50 }).default("flux-schnell"),
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
    
    // Embeddings para RAG multimodal (OpenCLIP ViT-H/14 - 1024 dim) - ARQUITETURA 100% GPU
    clipEmbedding: real("clip_embedding").array(),
    
    // Feedback e aprovação para training
    feedbackScore: integer("feedback_score"), // 1-5 estrelas
    approvedForTraining: boolean("approved_for_training").default(false),
    usedInFineTuning: boolean("used_in_fine_tuning").default(false),
    fineTuningJobId: uuid("fine_tuning_job_id").references(() => fineTuningJobs.id),
    
    // Métricas
    generationTimeMs: integer("generation_time_ms"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").default({}),
    
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
// MEDIA UPLOADS (FASE 9 - Multimodal: Imagem, Áudio, Vídeo)
// ============================================================================

export const mediaTypeEnum = pgEnum("media_type", [
  "image",
  "audio",
  "video",
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
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
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
    
    // Embeddings para RAG multimodal - ARQUITETURA ENTERPRISE (17/12/2025)
    clipEmbedding: real("clip_embedding").array(), // OpenCLIP ViT-H/14 para imagens (1024 dim → pgvector)
    textEmbedding: real("text_embedding").array(), // Qwen3-Embedding-8B para transcrição de áudio (4096 dim → Qdrant)
    
    // Transcrição (para áudio/vídeo)
    transcription: text("transcription"),
    transcriptionLanguage: varchar("transcription_language", { length: 10 }),
    transcriptionConfidence: real("transcription_confidence"),
    
    // Análise de conteúdo (guardrails)
    nsfwScore: real("nsfw_score"),
    piiDetected: boolean("pii_detected").default(false),
    piiDetails: jsonb("pii_details").default({}),
    contentFlags: jsonb("content_flags").default([]),
    
    // Metadata extraída (EXIF, etc.)
    extractedMetadata: jsonb("extracted_metadata").default({}),
    
    // Integração com LLM
    sentToLlm: boolean("sent_to_llm").default(false),
    llmDescription: text("llm_description"),
    
    // Training
    approvedForTraining: boolean("approved_for_training").default(false),
    usedInFineTuning: boolean("used_in_fine_tuning").default(false),
    
    criadoEm: timestamp("criado_em").defaultNow(),
    processadoEm: timestamp("processado_em"),
  },
  (table) => ({
    idxMediaUploadsTenantConversation: index("idx_media_uploads_tenant_conversation").on(table.tenantId, table.conversationId),
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

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 100 }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    description: text("description"),
    metadata: jsonb("metadata").default({}),
    createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxFeatureFlagsKey: index("idx_feature_flags_key").on(table.key),
    idxFeatureFlagsTenantKey: index("idx_feature_flags_tenant_key").on(table.tenantId, table.key),
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

// Wise-ERPNext Sync Types (FASE 5.5)
export type WiseSyncLog = typeof wiseSyncLog.$inferSelect;
export type InsertWiseSyncLog = typeof wiseSyncLog.$inferInsert;

// Webhook Events Types (Idempotência - Segurança Enterprise)
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type InsertWebhookEvent = typeof webhookEvents.$inferInsert;

// Stripe ERPNext Mapping Types (Rastreabilidade de documentos)
export type StripeErpnextMapping = typeof stripeErpnextMapping.$inferSelect;
export type InsertStripeErpnextMapping = typeof stripeErpnextMapping.$inferInsert;

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
  processadoEm: true,
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

// Wise-ERPNext Sync Insert Schema (FASE 5.5)
export const insertWiseSyncLogSchema: z.ZodType<unknown> = createInsertSchema(wiseSyncLog).omit({
  id: true,
  criadoEm: true,
  sincronizadoEm: true,
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
