-- ============================================================================
-- Gate 2: Defaults para Agents (modeloBase + maxTokens)
-- Autor: Fillipe Guerra
-- Data: 15 de Janeiro de 2026
--
-- Objetivo:
-- - Evitar defaults legados (VLM/Mixtral/Mistral) após a migração de arquitetura
-- - LLM (texto) padrão: Qwen2.5 7B Instruct (AWQ)
-- - Manter max_tokens padrão em 2048 (saída) para previsibilidade de latência/custo
-- ============================================================================

ALTER TABLE agents
  ALTER COLUMN modelo_base SET DEFAULT 'Qwen2.5-7B-Instruct-AWQ';

ALTER TABLE agents
  ALTER COLUMN max_tokens SET DEFAULT 2048;

