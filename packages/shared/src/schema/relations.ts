/**
 * Schema Relations - Alice Enterprise Platform
 * 
 * Definições de relacionamentos Drizzle ORM entre tabelas.
 * Centraliza todos os relations para evitar dependências circulares.
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * TypeScript strict (Regra 8 CLAUDE.md)
 * 
 * @module @alice/shared/schema/relations
 */

import { relations } from "drizzle-orm";

// Core
import {
  tenants,
  users,
  permissions,
  rolePermissions,
  oauthClients,
  oauthAuthorizationCodes,
  oauthTokens,
  featureFlags,
} from "./core.js";

// RAG
import {
  namespaces,
  agents,
  documents,
  documentChunks,
} from "./rag.js";

// Chat
import {
  conversations,
  messages,
  conversationStates,
  conversationParticipants,
  conversationEscalations,
} from "./chat.js";

// Training
import {
  trainingData,
  fineTuningJobs,
  modelVersions,
  autoLearningSchedule,
} from "./training.js";

// Integrations
import {
  integrations,
  auditLogs,
  webhookEvents,
  stripeErpnextMapping,
  wiseSyncLog,
} from "./integrations.js";

// Media
import {
  generatedImages,
  mediaUploads,
} from "./media.js";

// ============================================================================
// TENANTS RELATIONS
// ============================================================================

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  namespaces: many(namespaces),
  agents: many(agents),
  conversations: many(conversations),
  documents: many(documents),
  integrations: many(integrations),
  auditLogs: many(auditLogs),
  trainingData: many(trainingData),
  fineTuningJobs: many(fineTuningJobs),
  modelVersions: many(modelVersions),
  generatedImages: many(generatedImages),
  mediaUploads: many(mediaUploads),
  featureFlags: many(featureFlags),
  webhookEvents: many(webhookEvents),
  wiseSyncLog: many(wiseSyncLog),
  stripeErpnextMapping: many(stripeErpnextMapping),
}));

// ============================================================================
// USERS RELATIONS
// ============================================================================

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  conversations: many(conversations),
  documents: many(documents),
  auditLogs: many(auditLogs),
  generatedImages: many(generatedImages),
  mediaUploads: many(mediaUploads),
  conversationParticipants: many(conversationParticipants),
}));

// ============================================================================
// NAMESPACES RELATIONS
// ============================================================================

export const namespacesRelations = relations(namespaces, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [namespaces.tenantId],
    references: [tenants.id],
  }),
  agents: many(agents),
  documents: many(documents),
  conversations: many(conversations),
}));

// ============================================================================
// AGENTS RELATIONS
// ============================================================================

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
}));

// ============================================================================
// DOCUMENTS RELATIONS
// ============================================================================

export const documentsRelations = relations(documents, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [documents.tenantId],
    references: [tenants.id],
  }),
  namespace: one(namespaces, {
    fields: [documents.namespaceId],
    references: [namespaces.id],
  }),
  uploadedByUser: one(users, {
    fields: [documents.uploadedBy],
    references: [users.id],
  }),
  chunks: many(documentChunks),
}));

// ============================================================================
// DOCUMENT CHUNKS RELATIONS
// ============================================================================

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, {
    fields: [documentChunks.documentId],
    references: [documents.id],
  }),
  tenant: one(tenants, {
    fields: [documentChunks.tenantId],
    references: [tenants.id],
  }),
}));

// ============================================================================
// CONVERSATIONS RELATIONS
// ============================================================================

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [conversations.tenantId],
    references: [tenants.id],
  }),
  namespace: one(namespaces, {
    fields: [conversations.namespaceId],
    references: [namespaces.id],
  }),
  agent: one(agents, {
    fields: [conversations.agentId],
    references: [agents.id],
  }),
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  messages: many(messages),
  state: one(conversationStates),
  participants: many(conversationParticipants),
  escalations: many(conversationEscalations),
  generatedImages: many(generatedImages),
  mediaUploads: many(mediaUploads),
}));

// ============================================================================
// MESSAGES RELATIONS
// ============================================================================

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  generatedImages: many(generatedImages),
  mediaUploads: many(mediaUploads),
}));

// ============================================================================
// CONVERSATION STATES RELATIONS
// ============================================================================

export const conversationStatesRelations = relations(conversationStates, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationStates.conversationId],
    references: [conversations.id],
  }),
  assignedAgent: one(users, {
    fields: [conversationStates.assignedAgentId],
    references: [users.id],
  }),
}));

// ============================================================================
// CONVERSATION PARTICIPANTS RELATIONS
// ============================================================================

export const conversationParticipantsRelations = relations(conversationParticipants, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationParticipants.conversationId],
    references: [conversations.id],
  }),
  user: one(users, {
    fields: [conversationParticipants.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// CONVERSATION ESCALATIONS RELATIONS
// ============================================================================

export const conversationEscalationsRelations = relations(conversationEscalations, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationEscalations.conversationId],
    references: [conversations.id],
  }),
  requestedByUser: one(users, {
    fields: [conversationEscalations.requestedBy],
    references: [users.id],
  }),
  handledByUser: one(users, {
    fields: [conversationEscalations.handledBy],
    references: [users.id],
  }),
}));

// ============================================================================
// TRAINING DATA RELATIONS
// ============================================================================

export const trainingDataRelations = relations(trainingData, ({ one }) => ({
  tenant: one(tenants, {
    fields: [trainingData.tenantId],
    references: [tenants.id],
  }),
  namespace: one(namespaces, {
    fields: [trainingData.namespaceId],
    references: [namespaces.id],
  }),
}));

// ============================================================================
// FINE-TUNING JOBS RELATIONS
// ============================================================================

export const fineTuningJobsRelations = relations(fineTuningJobs, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [fineTuningJobs.tenantId],
    references: [tenants.id],
  }),
  modelVersions: many(modelVersions),
  generatedImages: many(generatedImages),
}));

// ============================================================================
// MODEL VERSIONS RELATIONS
// ============================================================================

export const modelVersionsRelations = relations(modelVersions, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [modelVersions.tenantId],
    references: [tenants.id],
  }),
  fineTuningJob: one(fineTuningJobs, {
    fields: [modelVersions.fineTuningJobId],
    references: [fineTuningJobs.id],
  }),
  autoLearningSchedules: many(autoLearningSchedule),
}));

// ============================================================================
// AUTO-LEARNING SCHEDULE RELATIONS
// ============================================================================

export const autoLearningScheduleRelations = relations(autoLearningSchedule, ({ one }) => ({
  tenant: one(tenants, {
    fields: [autoLearningSchedule.tenantId],
    references: [tenants.id],
  }),
  modelVersion: one(modelVersions, {
    fields: [autoLearningSchedule.modelVersionId],
    references: [modelVersions.id],
  }),
}));

// ============================================================================
// INTEGRATIONS RELATIONS
// ============================================================================

export const integrationsRelations = relations(integrations, ({ one }) => ({
  tenant: one(tenants, {
    fields: [integrations.tenantId],
    references: [tenants.id],
  }),
}));

// ============================================================================
// AUDIT LOGS RELATIONS
// ============================================================================

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
// WEBHOOK EVENTS RELATIONS
// ============================================================================

export const webhookEventsRelations = relations(webhookEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [webhookEvents.tenantId],
    references: [tenants.id],
  }),
}));

// ============================================================================
// STRIPE-ERPNEXT MAPPING RELATIONS
// ============================================================================

export const stripeErpnextMappingRelations = relations(stripeErpnextMapping, ({ one }) => ({
  tenant: one(tenants, {
    fields: [stripeErpnextMapping.tenantId],
    references: [tenants.id],
  }),
}));

// ============================================================================
// WISE SYNC LOG RELATIONS
// ============================================================================

export const wiseSyncLogRelations = relations(wiseSyncLog, ({ one }) => ({
  tenant: one(tenants, {
    fields: [wiseSyncLog.tenantId],
    references: [tenants.id],
  }),
}));

// ============================================================================
// GENERATED IMAGES RELATIONS
// ============================================================================

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
  fineTuningJob: one(fineTuningJobs, {
    fields: [generatedImages.fineTuningJobId],
    references: [fineTuningJobs.id],
  }),
}));

// ============================================================================
// MEDIA UPLOADS RELATIONS
// ============================================================================

export const mediaUploadsRelations = relations(mediaUploads, ({ one }) => ({
  tenant: one(tenants, {
    fields: [mediaUploads.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [mediaUploads.userId],
    references: [users.id],
  }),
  conversation: one(conversations, {
    fields: [mediaUploads.conversationId],
    references: [conversations.id],
  }),
  message: one(messages, {
    fields: [mediaUploads.messageId],
    references: [messages.id],
  }),
}));

// ============================================================================
// PERMISSIONS RELATIONS
// ============================================================================

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

// ============================================================================
// OAUTH RELATIONS
// ============================================================================

export const oauthClientsRelations = relations(oauthClients, ({ many }) => ({
  authorizationCodes: many(oauthAuthorizationCodes),
  tokens: many(oauthTokens),
}));

export const oauthAuthorizationCodesRelations = relations(oauthAuthorizationCodes, ({ one }) => ({
  client: one(oauthClients, {
    fields: [oauthAuthorizationCodes.clientId],
    references: [oauthClients.id],
  }),
  user: one(users, {
    fields: [oauthAuthorizationCodes.userId],
    references: [users.id],
  }),
}));

export const oauthTokensRelations = relations(oauthTokens, ({ one }) => ({
  client: one(oauthClients, {
    fields: [oauthTokens.clientId],
    references: [oauthClients.id],
  }),
  user: one(users, {
    fields: [oauthTokens.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// FEATURE FLAGS RELATIONS
// ============================================================================

export const featureFlagsRelations = relations(featureFlags, ({ one }) => ({
  tenant: one(tenants, {
    fields: [featureFlags.tenantId],
    references: [tenants.id],
  }),
  createdByUser: one(users, {
    fields: [featureFlags.createdBy],
    references: [users.id],
  }),
  updatedByUser: one(users, {
    fields: [featureFlags.updatedBy],
    references: [users.id],
  }),
}));
