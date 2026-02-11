-- Migration: 0064_system_config
-- Descrição: Tabela para configurações de sistema editáveis via UI (RAG, Chat, Treino).
-- Valores em DB têm precedência sobre variáveis de ambiente.
-- Autor: Fillipe Guerra
-- Data: 11 de Fevereiro de 2026
-- Ref: TREINAMENTO-LIMITES-E-BOAS-PRATICAS, SystemSettings enterprise

CREATE TABLE IF NOT EXISTS system_config (
  key varchar(128) PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE system_config IS 'Configurações de sistema editáveis via UI. Chaves: DOCUMENT_MAX_CHUNKS, TRAINING_DOC_MAX_SAMPLES, TRAINING_CONVERSATION_MAX_MESSAGES, CONVERSATION_SLICE_SIZE, MIN_ONDEMAND_DATASET_SIZE, maxSeqLen.';
