-- Migration: Trading Guardrail Thresholds
-- Tabela para thresholds institucionais DSR/PBO calibrados por bucket
-- (tenantId × marketType × intent × regime × liquidityTier)
-- com suporte a calibração assíncrona via Redis queue e split temporal.
--
-- Ref: CLAUDE.md Regra 6 (Enterprise-grade, sem hardcode), Regra 7 (Mudanças cirúrgicas)
-- Autor: Fillipe Guerra
-- Data: 23/02/2026

-- ============================================================================
-- Enum: regime de mercado para guardrails
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE "public"."trading_market_regime" AS ENUM (
    'low_vol_trend',
    'high_vol_trend',
    'low_vol_range',
    'high_vol_range',
    'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Enum: tier de liquidez
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE "public"."trading_liquidity_tier" AS ENUM (
    'high',
    'medium',
    'low',
    'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Tabela: trading_guardrail_thresholds
-- Armazena thresholds DSR/PBO por bucket (tenant + mercado + intent + regime + liquidez)
-- Calibração ocorre via job assíncrono no worker Redis queue.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "trading_guardrail_thresholds" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"       uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "market_type"     "trading_market_type" NOT NULL,
  "intent"          "trading_operation_intent" NOT NULL,
  "regime"          "trading_market_regime" NOT NULL DEFAULT 'unknown',
  "liquidity_tier"  "trading_liquidity_tier" NOT NULL DEFAULT 'unknown',
  -- Threshold mínimo de DSR (Deflated Sharpe Ratio); 0 = sem restrição
  "dsr_min"         numeric(10, 6) NOT NULL DEFAULT 0,
  -- Threshold máximo de PBO (Probability of Backtest Overfitting); 1 = sem restrição
  "pbo_max"         numeric(10, 6) NOT NULL DEFAULT 0.7,
  -- Número mínimo de amostras exigidas para aceitar este threshold (evitar overfitting)
  "min_samples"     integer NOT NULL DEFAULT 30,
  -- Fonte/contexto da calibração (backtest_split, manual, bootstrap, default)
  "provenance"      varchar(64) NOT NULL DEFAULT 'default',
  "updated_at"      timestamp NOT NULL DEFAULT now(),
  "created_at"      timestamp NOT NULL DEFAULT now()
);

-- Índice único por bucket — apenas um threshold ativo por combinação
CREATE UNIQUE INDEX IF NOT EXISTS "uq_trading_guardrail_thresholds_bucket"
  ON "trading_guardrail_thresholds"("tenant_id", "market_type", "intent", "regime", "liquidity_tier");

-- Índice de lookup rápido por tenant
CREATE INDEX IF NOT EXISTS "idx_trading_guardrail_thresholds_tenant"
  ON "trading_guardrail_thresholds"("tenant_id");

-- ============================================================================
-- RLS: apenas o tenant dono pode ler/escrever seus thresholds
-- ============================================================================
ALTER TABLE "trading_guardrail_thresholds" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "trading_guardrail_thresholds_tenant_isolation"
    ON "trading_guardrail_thresholds"
    USING ("tenant_id" = current_setting('app.tenant_id', TRUE)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
