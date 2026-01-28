-- Remove suporte a sandbox KuCoin (offline)
-- Regra 6: sem workarounds, remover campo legado

ALTER TABLE trading_risk_config
  DROP COLUMN IF EXISTS kucoin_sandbox;
