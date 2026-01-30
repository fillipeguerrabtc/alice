-- Adiciona toggles de observabilidade (Grafana) ao Agentic Settings
ALTER TABLE agentic_settings
  ADD COLUMN IF NOT EXISTS observability_read_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS observability_write_enabled boolean NOT NULL DEFAULT true;
