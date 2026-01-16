-- ============================================================================
-- Gate 2: Migração de agentes legados (modeloBase + maxTokens)
-- Autor: Fillipe Guerra
-- Data: 16 de Janeiro de 2026
--
-- Objetivo:
-- - Evitar "silent model swap" no Chat Service:
--   * Chat Service valida modelo_base contra allowlist (texto-only).
--   * Valores legados (VLM/Mixtral/Mistral) não devem permanecer em agents.modelo_base.
-- - Normalizar max_tokens para o budget do stack (2048) quando acima do limite.
-- ============================================================================

UPDATE agents
SET modelo_base = 'Qwen2.5-7B-Instruct-AWQ'
WHERE modelo_base IN (
  'Mistral-7B-Instruct',
  'Mistral-7B-Instruct-AWQ',
  'Qwen2.5-VL-7B',
  'Qwen2.5-VL-7B-AWQ',
  'Qwen2.5-VL-7B-Instruct-AWQ',
  'Mixtral-8x7B'
);

UPDATE agents
SET max_tokens = 2048
WHERE max_tokens > 2048;

