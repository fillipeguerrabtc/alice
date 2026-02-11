-- Migration: 0058_model_versions_namespace_id
-- Descrição: Adiciona namespace_id em model_versions para LoRA por namespace (adaptador por namespace).
-- Autor: Fillipe Guerra
-- Data: 11 de Fevereiro de 2026

-- Coluna opcional: NULL = adapter tenant-wide (retrocompat); preenchido = adapter exclusivo do namespace.
ALTER TABLE model_versions
  ADD COLUMN IF NOT EXISTS namespace_id UUID REFERENCES namespaces(id);

CREATE INDEX IF NOT EXISTS idx_model_versions_namespace ON model_versions(namespace_id);

COMMENT ON COLUMN model_versions.namespace_id IS 'Escopo do adapter: NULL = tenant-wide; preenchido = adapter exclusivo do namespace (LoRA por namespace).';
