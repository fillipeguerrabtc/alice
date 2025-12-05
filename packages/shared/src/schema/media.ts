/**
 * Schema Media - Alice Enterprise Platform
 * 
 * Tabelas de mídia: generated images, media uploads.
 * Domínio de geração de imagens e uploads multimodais.
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * TypeScript strict (Regra 8 CLAUDE.md)
 * 
 * @module @alice/shared/schema/media
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
  generatedImageStatusEnum,
  mediaTypeEnum,
  mediaProcessingStatusEnum,
} from "./enums.js";
import { tenants, users } from "./core.js";
import {
  GenericMetadata,
  PiiDetails,
  ContentFlags,
  ExtractedMetadata,
} from "./shared-zod.js";

// Forward references para evitar dependência circular
// Estas tabelas serão definidas em chat.ts
declare const conversations: { id: ReturnType<typeof uuid> };
declare const messages: { id: ReturnType<typeof uuid> };
declare const fineTuningJobs: { id: ReturnType<typeof uuid> };

// ============================================================================
// GENERATED IMAGES (FLUX.1 Schnell Self-Hosted)
// ============================================================================

export const generatedImages = pgTable(
  "generated_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    conversationId: uuid("conversation_id"),
    messageId: uuid("message_id"),
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
    
    // Embeddings para RAG multimodal (CLIP - 768 dimensões)
    clipEmbedding: real("clip_embedding").array(),
    
    // Feedback e aprovação para training
    feedbackScore: integer("feedback_score"),
    approvedForTraining: boolean("approved_for_training").default(false),
    usedInFineTuning: boolean("used_in_fine_tuning").default(false),
    fineTuningJobId: uuid("fine_tuning_job_id"),
    
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
// MEDIA UPLOADS (Multimodal: Imagem, Áudio, Vídeo)
// ============================================================================

export const mediaUploads = pgTable(
  "media_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id"),
    messageId: uuid("message_id"),
    
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
    duration: real("duration"),
    
    // Processamento
    processingStatus: mediaProcessingStatusEnum("processing_status").default("pending"),
    processingError: text("processing_error"),
    processingTimeMs: integer("processing_time_ms"),
    
    // Embeddings para RAG multimodal
    clipEmbedding: real("clip_embedding").array(),
    textEmbedding: real("text_embedding").array(),
    
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
// INSERT SCHEMAS (drizzle-zod)
// ============================================================================

export const insertGeneratedImageSchema = createInsertSchema(generatedImages).omit({
  id: true,
  criadoEm: true,
});
export type InsertGeneratedImage = z.infer<typeof insertGeneratedImageSchema>;
export type GeneratedImage = typeof generatedImages.$inferSelect;

export const insertMediaUploadSchema = createInsertSchema(mediaUploads).omit({
  id: true,
  criadoEm: true,
  processadoEm: true,
});
export type InsertMediaUpload = z.infer<typeof insertMediaUploadSchema>;
export type MediaUpload = typeof mediaUploads.$inferSelect;
