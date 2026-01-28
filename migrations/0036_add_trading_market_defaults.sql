-- Adiciona defaults de mercado e modo de margem
-- Regra 6: sem workarounds, persistência real em PostgreSQL

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trading_margin_mode') THEN
    CREATE TYPE trading_margin_mode AS ENUM ('cross', 'isolated');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_risk_config') THEN
    ALTER TABLE trading_risk_config
      ADD COLUMN IF NOT EXISTS default_market_type trading_market_type DEFAULT 'futures' NOT NULL,
      ADD COLUMN IF NOT EXISTS margin_mode trading_margin_mode DEFAULT 'cross' NOT NULL;
  END IF;
END $$;
