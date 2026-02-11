-- Migration: 0061_auto_learning_schedule_lora_job_id
-- Descrição: Referência ao job LoRA criado por runs agendados (fonte de verdade: lora_jobs)
-- Autor: Fillipe Guerra
-- Data: 11 de Fevereiro de 2026
-- Ref: Runs agendados/on-demand usam somente lora_jobs com source=scheduled_run

ALTER TABLE auto_learning_schedule
  ADD COLUMN IF NOT EXISTS lora_job_id uuid REFERENCES lora_jobs(id);

CREATE INDEX IF NOT EXISTS idx_auto_learning_schedule_lora_job
  ON auto_learning_schedule(lora_job_id);

COMMENT ON COLUMN auto_learning_schedule.lora_job_id IS 'Job LoRA criado pelo run agendado (source=scheduled_run). Preenchido quando o treino é disparado via scheduler.';
