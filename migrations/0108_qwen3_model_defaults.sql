-- 0108_qwen3_model_defaults.sql
-- Objetivo: alinhar defaults de modelo LLM para Qwen3 no schema canônico.
-- Escopo: apenas defaults para novos registros (sem reescrever histórico legado).

ALTER TABLE agents
  ALTER COLUMN modelo_base SET DEFAULT 'Qwen3-8B';

ALTER TABLE llm_config
  ALTER COLUMN modelo SET DEFAULT 'Qwen3-8B';

DO $$
BEGIN
  -- Compatibilidade entre tabela canônica atual e nome legado.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lora_jobs') THEN
    ALTER TABLE lora_jobs
      ALTER COLUMN base_model SET DEFAULT 'Qwen/Qwen3-8B-AWQ';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_lora_jobs') THEN
    ALTER TABLE trading_lora_jobs
      ALTER COLUMN base_model SET DEFAULT 'Qwen/Qwen3-8B-AWQ';
  ELSE
    RAISE NOTICE 'Tabela LoRA não encontrada (lora_jobs/trading_lora_jobs) - pulando default de base_model';
  END IF;
END
$$;

ALTER TABLE model_versions
  ALTER COLUMN base_model SET DEFAULT 'Qwen3-8B';
