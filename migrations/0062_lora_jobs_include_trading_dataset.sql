-- Migration: 0062_lora_jobs_include_trading_dataset
-- Descrição: Persiste flag includeTradingDataset no job para consistência entre contagem na criação e dados no processamento.
-- Autor: Fillipe Guerra
-- Data: 11 de Fevereiro de 2026
-- Ref: processLoraJob usava !!namespaceId; createScheduledRunLoraJob não gravava o valor usado na contagem.

ALTER TABLE lora_jobs
  ADD COLUMN IF NOT EXISTS include_trading_dataset boolean DEFAULT NULL;

COMMENT ON COLUMN lora_jobs.include_trading_dataset IS 'Se true, inclui trading_dataset no treino; se false, apenas chat. NULL = backward compat (inferir de scope_namespace_id).';
