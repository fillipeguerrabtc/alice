/**
 * Schema Chat - Alice Enterprise Platform
 * 
 * Tabelas de chat: conversations, messages, handover/takeover.
 * Domínio de comunicação em tempo real.
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 * TypeScript strict (Regra 8 replit.md)
 * 
 * @module @alice/shared/schema/chat
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
  messageTypeEnum,
  conversationStatusEnum,
  conversationControlModeEnum,
  escalationTriggerEnum,
  messageOriginEnum,
} from "./enums.js";
import { tenants, users } from "./core.js";
import {
  MessageAnexos,
  MessageMetadata,
  ConversationMetadata,
  GenericMetadata,
  EscalationTriggerDetails,
} from "./shared-zod.js";

// ============================================================================
// CONVERSAS
// ============================================================================

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    namespaceId: uuid("namespace_id"), // FK definida em relations.ts
    agentId: uuid("agent_id"), // FK definida em relations.ts
    userId: varchar("user_id").references(() => users.id),
    titulo: varchar("titulo", { length: 500 }),
    resumo: text("resumo"),
    status: conversationStatusEnum("status").default("active"),
    mensagensCount: integer("mensagens_count").default(0),
    ultimaMensagemEm: timestamp("ultima_mensagem_em"),
    metadata: jsonb("metadata").$type<ConversationMetadata>().default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
    arquivadoEm: timestamp("arquivado_em"),
  },
  (table) => ({
    idxConversationsTenant: index("idx_conversations_tenant").on(table.tenantId),
    idxConversationsNamespace: index("idx_conversations_namespace").on(table.namespaceId),
    idxConversationsUser: index("idx_conversations_user").on(table.userId),
    idxConversationsStatus: index("idx_conversations_status").on(table.status),
    idxConversationsCreated: index("idx_conversations_created").on(table.criadoEm),
  })
);

// ============================================================================
// MENSAGENS
// ============================================================================

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    tipo: messageTypeEnum("tipo").default("text"),
    origem: messageOriginEnum("origem").default("bot"),
    anexos: jsonb("anexos").$type<MessageAnexos>().default([]),
    metadata: jsonb("metadata").$type<MessageMetadata>().default({}),
    tokensPrompt: integer("tokens_prompt"),
    tokensCompletion: integer("tokens_completion"),
    latencyMs: integer("latency_ms"),
    feedbackPositivo: boolean("feedback_positivo"),
    feedbackTexto: text("feedback_texto"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxMessagesConversation: index("idx_messages_conversation").on(table.conversationId),
    idxMessagesRole: index("idx_messages_role").on(table.role),
    idxMessagesCreated: index("idx_messages_created").on(table.criadoEm),
    idxMessagesOrigem: index("idx_messages_origem").on(table.origem),
  })
);

// ============================================================================
// TAKEOVER/HANDOVER - Estado da Conversa
// ============================================================================

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

// ============================================================================
// PARTICIPANTES DA CONVERSA
// ============================================================================

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),
    userId: varchar("user_id").references(() => users.id),
    role: varchar("role", { length: 50 }).notNull(),
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

// ============================================================================
// ESCALAÇÕES
// ============================================================================

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
// INSERT SCHEMAS (drizzle-zod)
// ============================================================================

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  criadoEm: true,
});
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

export const insertConversationStateSchema = createInsertSchema(conversationStates).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});
export type InsertConversationState = z.infer<typeof insertConversationStateSchema>;
export type ConversationState = typeof conversationStates.$inferSelect;

export const insertConversationEscalationSchema = createInsertSchema(conversationEscalations).omit({
  id: true,
  criadoEm: true,
});
export type InsertConversationEscalation = z.infer<typeof insertConversationEscalationSchema>;
export type ConversationEscalation = typeof conversationEscalations.$inferSelect;
