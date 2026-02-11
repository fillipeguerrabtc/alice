-- Migration: 0063_lora_jobs_include_images
-- Descrição: Persiste flag includeImages no job para contagem e uso no preparer (imagens aprovadas).
-- Autor: Fillipe Guerra
-- Data: 11 de Fevereiro de 2026
-- Ref: includeImages era aceito mas ignorado; imagesUsed era hardcoded 0.

ALTER TABLE lora_jobs
  ADD COLUMN IF NOT EXISTS include_images boolean DEFAULT false;

COMMENT ON COLUMN lora_jobs.include_images IS 'Se true, inclui contagem de imagens aprovadas (generated_images) e retorna imagesUsed no fluxo scheduled_run.';
