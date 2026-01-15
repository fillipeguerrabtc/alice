-- ============================================================================
-- Gate 2: Defaults para Agents (modeloBase + maxTokens)
-- Autor: Fillipe Guerra
-- Data: 15 de Janeiro de 2026
--
-- Objetivo:
-- - Evitar defaults legados (Qwen/Mixtral) após Gate 2 (LLM texto = Mistral)
-- - Manter max_tokens coerente com max-model-len padrão do stack (2048)
-- ============================================================================

ALTER TABLE agents
  ALTER COLUMN modelo_base SET DEFAULT 'Mistral-7B-Instruct-AWQ';

ALTER TABLE agents
  ALTER COLUMN max_tokens SET DEFAULT 2048;

