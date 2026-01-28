-- =============================================================================
-- Migration 0033: Market Type para Trading (Futures/Spot/Margin)
-- =============================================================================
-- Adiciona suporte explícito a marketType nos registros de trading.
-- Necessário para operações multi-mercado (Spot/Margin/Futures).
--
-- Autor: Fillipe Guerra
-- Data: 27 de Janeiro de 2026
-- Regra 6: Persistência real em PostgreSQL (sem mocks)
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trading_market_type') THEN
        CREATE TYPE trading_market_type AS ENUM ('futures', 'spot', 'margin');
    END IF;
END $$;

ALTER TABLE trading_signals
    ADD COLUMN IF NOT EXISTS market_type trading_market_type NOT NULL DEFAULT 'futures';

ALTER TABLE trading_orders
    ADD COLUMN IF NOT EXISTS market_type trading_market_type NOT NULL DEFAULT 'futures';

ALTER TABLE trading_positions
    ADD COLUMN IF NOT EXISTS market_type trading_market_type NOT NULL DEFAULT 'futures';

CREATE INDEX IF NOT EXISTS idx_trading_signals_market_type
    ON trading_signals(market_type);

CREATE INDEX IF NOT EXISTS idx_trading_orders_market_type
    ON trading_orders(market_type);

CREATE INDEX IF NOT EXISTS idx_trading_positions_market_type
    ON trading_positions(market_type);
