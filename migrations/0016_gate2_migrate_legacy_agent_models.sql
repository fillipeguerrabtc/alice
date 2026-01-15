-- ============================================================================
-- Gate 2: Migração de agentes legados (modeloBase + maxTokens)
-- Autor: Fillipe Guerra
-- Data: 15 de Janeiro de 2026
--
-- Objetivo:
-- - Evitar "silent model swap" no Chat Service:
--   * Gate 2 roteia chat (texto) para GpuServiceType.LLM (Mistral).
--   * Valores legados (Qwen2.5-VL/Mixtral) não devem permanecer em agents.modelo_base.
-- - Normalizar max_tokens para o budget do stack (2048) quando acima do limite.
-- ============================================================================

UPDATE agents
SET modelo_base = 'Mistral-7B-Instruct-AWQ'
WHERE modelo_base IN (
  'Qwen2.5-VL-7B',
  'Qwen2.5-VL-7B-AWQ',
  'Qwen2.5-VL-7B-Instruct-AWQ',
  'Mixtral-8x7B'
);

UPDATE agents
SET max_tokens = 2048
WHERE max_tokens > 2048;

