/**
 * Schema Core - Alice Enterprise Platform
 * 
 * Tabelas fundamentais: tenants, users, sessions, permissions, OAuth, OIDC, feature flags.
 * Base para todos os outros domínios.
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 * TypeScript strict (Regra 8 replit.md)
 * 
 * @module @alice/shared/schema/core
 */

import { sql } from "drizzle-orm";
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
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { userRoleEnum } from "./enums.js";
import {
  TenantConfiguracoes,
  UserPreferencias,
  SessionData,
} from "./shared-zod.js";

// ============================================================================
// SESSÕES (Replit Auth - OBRIGATÓRIO)
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
// USUÁRIOS (Autenticação Unificada: OAuth + SAML + Local)
// Compatível com: Replit (DEV) e Hetzner Cloud (PROD)
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
    preferencias: jsonb("preferencias").$type<UserPreferencias>().default({}),
    ultimoAcesso: timestamp("ultimo_acesso"),
    ativo: boolean("ativo").default(true),
    // Autenticação Multi-provedor
    passwordHash: text("password_hash"),
    authProvider: varchar("auth_provider", { length: 50 }),
    authProviderId: varchar("auth_provider_id", { length: 255 }),
    // IDs OAuth específicos por provedor
    googleId: varchar("google_id", { length: 255 }),
    githubId: varchar("github_id", { length: 255 }),
    microsoftId: varchar("microsoft_id", { length: 255 }),
    samlNameId: varchar("saml_name_id", { length: 255 }),
    emailVerified: boolean("email_verified").default(false),
    // Stripe
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
    idxUsersMicrosoftId: index("idx_users_microsoft_id").on(table.microsoftId),
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

// ============================================================================
// OIDC PAYLOADS (node-oidc-provider v9.5.2 - Persistência PostgreSQL)
// Seguindo Regra 6 replit.md: PROIBIDO in-memory storage
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
// OIDC JWKS (Persistência de Chaves RS256 - Regra 6 replit.md)
// ============================================================================

export const oidcJwks = pgTable(
  "oidc_jwks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kid: varchar("kid", { length: 64 }).notNull().unique(),
    alg: varchar("alg", { length: 16 }).notNull().default("RS256"),
    use: varchar("use", { length: 8 }).notNull().default("sig"),
    kty: varchar("kty", { length: 8 }).notNull().default("RSA"),
    privateKey: text("private_key").notNull(),
    publicKey: text("public_key").notNull(),
    isActive: boolean("is_active").default(true),
    expiresAt: timestamp("expires_at"),
    criadoEm: timestamp("criado_em").defaultNow(),
    rotatedAt: timestamp("rotated_at"),
  },
  (table) => ({
    idxOidcJwksKid: index("idx_oidc_jwks_kid").on(table.kid),
    idxOidcJwksActive: index("idx_oidc_jwks_active").on(table.isActive),
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
// INSERT SCHEMAS (drizzle-zod)
// ============================================================================

export const insertTenantSchema = createInsertSchema(tenants).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenants.$inferSelect;

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const insertPermissionSchema = createInsertSchema(permissions).omit({
  id: true,
  criadoEm: true,
});
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type Permission = typeof permissions.$inferSelect;

export const insertOAuthClientSchema = createInsertSchema(oauthClients).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});
export type InsertOAuthClient = z.infer<typeof insertOAuthClientSchema>;
export type OAuthClient = typeof oauthClients.$inferSelect;

export const insertFeatureFlagSchema = createInsertSchema(featureFlags).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});
export type InsertFeatureFlag = z.infer<typeof insertFeatureFlagSchema>;
export type FeatureFlag = typeof featureFlags.$inferSelect;
