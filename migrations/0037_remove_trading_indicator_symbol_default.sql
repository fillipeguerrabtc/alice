-- =============================================================================
-- Migration 0037: Remover default de símbolo em indicadores técnicos
-- =============================================================================
-- Regra 6: Sem hardcoded - símbolo deve ser sempre informado pela aplicação.
--
-- Autor: Fillipe Guerra
-- Data: 27 de Janeiro de 2026
-- =============================================================================

ALTER TABLE trading_technical_indicators
  ALTER COLUMN symbol DROP DEFAULT;
