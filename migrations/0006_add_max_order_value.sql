-- =============================================================================
-- Migration: Adiciona campo max_order_value na tabela trading_risk_config
-- =============================================================================
-- CORREÇÃO 17/12/2025: Campo maxOrderValue era usado no código mas não existia
-- no schema, causando validação de risco inoperante (Number(undefined) = NaN)
--
-- Autor: Fillipe Guerra
-- Data: 17 de Dezembro de 2025
-- =============================================================================

-- Adicionar coluna max_order_value com valor default de 10000 USD
ALTER TABLE trading_risk_config 
ADD COLUMN IF NOT EXISTS max_order_value REAL DEFAULT 10000;

-- Comentário explicativo
COMMENT ON COLUMN trading_risk_config.max_order_value IS 
  'Valor máximo por ordem em USD. Bug fix 17/12/2025: campo não existia, validação de risco era inoperante.';
