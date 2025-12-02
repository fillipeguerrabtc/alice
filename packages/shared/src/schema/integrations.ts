/**
 * Schema Integrations - Alice Enterprise Platform
 * 
 * Tabelas de integrações: integrations, audit logs, webhooks, Stripe-ERPNext, Wise sync.
 * Domínio de integrações externas e auditoria.
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 * TypeScript strict (Regra 8 replit.md)
 * 
 * @module @alice/shared/schema/integrations
 */

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
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { 
  webhookSourceEnum, 
  wiseSyncStatusEnum,
  backupJobStatusEnum,
  backupTypeEnum,
  backupComponentStatusEnum,
} from "./enums.js";
import { tenants, users } from "./core.js";
import {
  IntegrationConfiguracao,
  IntegrationCredenciais,
  AuditLogDetalhes,
  WebhookPayload,
  GenericMetadata,
} from "./shared-zod.js";

// ============================================================================
// INTEGRAÇÕES EXTERNAS
// ============================================================================

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    tipo: varchar("tipo", { length: 50 }).notNull(),
    nome: varchar("nome", { length: 255 }).notNull(),
    descricao: text("descricao"),
    configuracao: jsonb("configuracao").$type<IntegrationConfiguracao>().default({}),
    credenciais: jsonb("credenciais").$type<IntegrationCredenciais>().default({}),
    ativo: boolean("ativo").default(true),
    ultimaSincronizacao: timestamp("ultima_sincronizacao"),
    erroUltimaSincronizacao: text("erro_ultima_sincronizacao"),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxIntegrationsTenant: index("idx_integrations_tenant").on(table.tenantId),
    idxIntegrationsTipo: index("idx_integrations_tipo").on(table.tipo),
    idxIntegrationsAtivo: index("idx_integrations_ativo").on(table.ativo),
  })
);

// ============================================================================
// AUDIT LOGS (Trilha de Auditoria Enterprise)
// ============================================================================

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    userId: varchar("user_id").references(() => users.id),
    acao: varchar("acao", { length: 100 }).notNull(),
    entidade: varchar("entidade", { length: 100 }).notNull(),
    entidadeId: varchar("entidade_id", { length: 255 }),
    detalhes: jsonb("detalhes").$type<AuditLogDetalhes>().default({}),
    ip: varchar("ip", { length: 45 }),
    userAgent: text("user_agent"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxAuditLogsTenant: index("idx_audit_logs_tenant").on(table.tenantId),
    idxAuditLogsUser: index("idx_audit_logs_user").on(table.userId),
    idxAuditLogsAcao: index("idx_audit_logs_acao").on(table.acao),
    idxAuditLogsEntidade: index("idx_audit_logs_entidade").on(table.entidade),
    idxAuditLogsCreated: index("idx_audit_logs_created").on(table.criadoEm),
  })
);

// ============================================================================
// WEBHOOK EVENTS (Idempotência para Stripe/Wise - Segurança Enterprise)
// ============================================================================

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
// STRIPE-ERPNEXT MAPPING
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
    flowStatus: varchar("flow_status", { length: 50 }).default("pending"),
    metadata: jsonb("metadata").$type<GenericMetadata>().default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxStripeSession: index("idx_stripe_erpnext_session").on(table.stripeSessionId),
    idxStripePaymentIntent: index("idx_stripe_erpnext_payment_intent").on(table.stripePaymentIntentId),
    idxStripeCustomer: index("idx_stripe_erpnext_customer").on(table.stripeCustomerId),
    idxStripeFlowStatus: index("idx_stripe_erpnext_flow_status").on(table.flowStatus),
  })
);

// ============================================================================
// WISE-ERPNEXT SYNC LOG
// ============================================================================

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
    metadata: jsonb("metadata").$type<GenericMetadata>().default({}),
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
// INSERT SCHEMAS (drizzle-zod)
// ============================================================================

export const insertIntegrationSchema = createInsertSchema(integrations).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});
export type InsertIntegration = z.infer<typeof insertIntegrationSchema>;
export type Integration = typeof integrations.$inferSelect;

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  criadoEm: true,
});
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

export const insertWebhookEventSchema = createInsertSchema(webhookEvents).omit({
  id: true,
  criadoEm: true,
});
export type InsertWebhookEvent = z.infer<typeof insertWebhookEventSchema>;
export type WebhookEvent = typeof webhookEvents.$inferSelect;

export const insertStripeErpnextMappingSchema = createInsertSchema(stripeErpnextMapping).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});
export type InsertStripeErpnextMapping = z.infer<typeof insertStripeErpnextMappingSchema>;
export type StripeErpnextMapping = typeof stripeErpnextMapping.$inferSelect;

export const insertWiseSyncLogSchema = createInsertSchema(wiseSyncLog).omit({
  id: true,
  criadoEm: true,
});
export type InsertWiseSyncLog = z.infer<typeof insertWiseSyncLogSchema>;
export type WiseSyncLog = typeof wiseSyncLog.$inferSelect;

// ============================================================================
// BACKUP JOBS (Regra 6 - Enterprise-Grade Persistence)
// Estado de backup persistido em PostgreSQL (NÃO in-memory)
// ============================================================================

/**
 * Tipo JSONB para componentes do backup
 * Cada componente (postgresql, mariadb, redis, uploads) tem seu status
 */
export interface BackupComponentDetail {
  component: 'postgresql' | 'mariadb' | 'redis' | 'uploads';
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
 */
export interface BackupManifestData {
  components: {
    postgresql?: { status: string; lsn?: string; backupSet?: string; size?: string; walArchived?: boolean; };
    mariadb?: { status: string; gtid?: string; binlogPosition?: string; size?: string; };
    redis?: { status: string; rdbChecksum?: string; size?: string; };
    uploads?: { status: string; s3VersionId?: string; filesCount?: number; size?: string; };
  };
  offsite: { enabled: boolean; repository?: string; synced?: boolean; };
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
