-- =============================================================================
-- Migration 0048: Técnicas de Trading + Ensemble + Arbitragem Triangular
-- =============================================================================
-- Adiciona configuração de técnicas e ensemble no perfil de análise/sinais,
-- e campos opcionais de override nos schedulers.
--
-- Autor: Fillipe Guerra
-- Data: 02 de Fevereiro de 2026
-- Regra 6: Persistência real em PostgreSQL (sem mocks)
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trading_technique') THEN
        CREATE TYPE trading_technique AS ENUM (
            'scalping',
            'day_trade',
            'swing',
            'position',
            'trend',
            'mean_reversion',
            'breakout',
            'range',
            'momentum',
            'arbitrage_triangular'
        );
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_analysis_profiles') THEN
        ALTER TABLE trading_analysis_profiles
            ADD COLUMN IF NOT EXISTS techniques trading_technique[] NOT NULL
                DEFAULT ARRAY[
                    'scalping',
                    'day_trade',
                    'swing',
                    'position',
                    'trend',
                    'mean_reversion',
                    'breakout',
                    'range',
                    'momentum'
                ]::trading_technique[],
            ADD COLUMN IF NOT EXISTS ensemble_config jsonb NOT NULL
                DEFAULT '{"mode":"ensemble_top3","topN":3}'::jsonb,
            ADD COLUMN IF NOT EXISTS arbitrage_config jsonb;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_signal_schedulers') THEN
        ALTER TABLE trading_signal_schedulers
            ADD COLUMN IF NOT EXISTS techniques trading_technique[],
            ADD COLUMN IF NOT EXISTS ensemble_config jsonb,
            ADD COLUMN IF NOT EXISTS arbitrage_config jsonb;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_analysis_schedulers') THEN
        ALTER TABLE trading_analysis_schedulers
            ADD COLUMN IF NOT EXISTS techniques trading_technique[],
            ADD COLUMN IF NOT EXISTS ensemble_config jsonb,
            ADD COLUMN IF NOT EXISTS arbitrage_config jsonb;
    END IF;
END $$;
