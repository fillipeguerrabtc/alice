/**
 * Schema RAG - Alice Enterprise Platform
 * 
 * Tabelas de RAG: namespaces, documents, chunks, agents.
 * Domínio de Retrieval Augmented Generation.
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * TypeScript strict (Regra 8 CLAUDE.md)
 * 
 * @module @alice/shared/schema/rag
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

import { agentStatusEnum, documentStatusEnum } from "./enums.js";
import { tenants, users } from "./core.js";
import {
  NamespaceConfiguracoes,
  AgentMetricas,
  LlmConfigAvancada,
  GenericMetadata,
} from "./shared-zod.js";

// ============================================================================
// NAMESPACES (Contextos RAG)
// ============================================================================

export const namespaces = pgTable(
  "namespaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    nome: varchar("nome", { length: 255 }).notNull(),
    descricao: text("descricao"),
    systemPrompt: text("system_prompt"),
    configuracoes: jsonb("configuracoes").$type<NamespaceConfiguracoes>().default({}),
    isDefault: boolean("is_default").default(false),
    ativo: boolean("ativo").default(true),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxNamespacesTenant: index("idx_namespaces_tenant").on(table.tenantId),
    idxNamespacesDefault: index("idx_namespaces_default").on(table.isDefault),
  })
);

// ============================================================================
// AGENTES IA
// ============================================================================

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    namespaceId: uuid("namespace_id").references(() => namespaces.id),
    nome: varchar("nome", { length: 255 }).notNull(),
    descricao: text("descricao"),
    avatar: text("avatar"),
    modelo: varchar("modelo", { length: 100 }).default("llama4-maverick"),
    systemPrompt: text("system_prompt"),
    temperatura: real("temperatura").default(0.7),
    maxTokens: integer("max_tokens").default(2048),
    configAvancada: jsonb("config_avancada").$type<LlmConfigAvancada>().default({}),
    metricas: jsonb("metricas").$type<AgentMetricas>().default({}),
    status: agentStatusEnum("status").default("active"),
    isDefault: boolean("is_default").default(false),
    criadoEm: timestamp("criado_em").defaultNow(),
    atualizadoEm: timestamp("atualizado_em").defaultNow(),
  },
  (table) => ({
    idxAgentsTenant: index("idx_agents_tenant").on(table.tenantId),
    idxAgentsNamespace: index("idx_agents_namespace").on(table.namespaceId),
    idxAgentsStatus: index("idx_agents_status").on(table.status),
    idxAgentsDefault: index("idx_agents_default").on(table.isDefault),
  })
);

// ============================================================================
// DOCUMENTOS
// ============================================================================

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    namespaceId: uuid("namespace_id").references(() => namespaces.id),
    uploadedBy: varchar("uploaded_by").references(() => users.id),
    titulo: varchar("titulo", { length: 500 }).notNull(),
    tipo: varchar("tipo", { length: 50 }),
    mimeType: varchar("mime_type", { length: 100 }),
    tamanho: integer("tamanho"),
    caminho: text("caminho"),
    url: text("url"),
    conteudoOriginal: text("conteudo_original"),
    status: documentStatusEnum("status").default("pending"),
    chunksCount: integer("chunks_count").default(0),
    metadata: jsonb("metadata").$type<GenericMetadata>().default({}),
    erroProcessamento: text("erro_processamento"),
    criadoEm: timestamp("criado_em").defaultNow(),
    processadoEm: timestamp("processado_em"),
  },
  (table) => ({
    idxDocumentsTenant: index("idx_documents_tenant").on(table.tenantId),
    idxDocumentsNamespace: index("idx_documents_namespace").on(table.namespaceId),
    idxDocumentsStatus: index("idx_documents_status").on(table.status),
    idxDocumentsCreated: index("idx_documents_created").on(table.criadoEm),
  })
);

// ============================================================================
// CHUNKS DE DOCUMENTO (para busca vetorial)
// ============================================================================

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    conteudo: text("conteudo").notNull(),
    posicao: integer("posicao").notNull(),
    tokensCount: integer("tokens_count"),
    embedding: real("embedding").array(),
    metadata: jsonb("metadata").$type<GenericMetadata>().default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxChunksDocument: index("idx_chunks_document").on(table.documentId),
    idxChunksTenant: index("idx_chunks_tenant").on(table.tenantId),
    idxChunksPosition: index("idx_chunks_position").on(table.posicao),
  })
);

// ============================================================================
// INSERT SCHEMAS (drizzle-zod)
// ============================================================================

export const insertNamespaceSchema = createInsertSchema(namespaces).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});
export type InsertNamespace = z.infer<typeof insertNamespaceSchema>;
export type Namespace = typeof namespaces.$inferSelect;

export const insertAgentSchema = createInsertSchema(agents).omit({
  id: true,
  criadoEm: true,
  atualizadoEm: true,
});
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agents.$inferSelect;

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  criadoEm: true,
  processadoEm: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

export const insertDocumentChunkSchema = createInsertSchema(documentChunks).omit({
  id: true,
  criadoEm: true,
});
export type InsertDocumentChunk = z.infer<typeof insertDocumentChunkSchema>;
export type DocumentChunk = typeof documentChunks.$inferSelect;
