-- 0108_qwen3_model_defaults.sql
-- Objetivo: alinhar defaults de modelo LLM para Qwen3 no schema canônico.
-- Escopo: apenas defaults para novos registros (sem reescrever histórico legado).

ALTER TABLE agents
  ALTER COLUMN modelo_base SET DEFAULT 'Qwen3-8B';

ALTER TABLE llm_config
  ALTER COLUMN modelo SET DEFAULT 'Qwen3-8B';

ALTER TABLE trading_lora_jobs
  ALTER COLUMN base_model SET DEFAULT 'Qwen/Qwen3-8B-AWQ';

ALTER TABLE model_versions
  ALTER COLUMN base_model SET DEFAULT 'Qwen3-8B';
