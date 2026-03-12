-- 0109_trading_auto_run_terminal_states.sql
-- Objetivo: promover estados terminais do Auto Engine para first-class product states queryáveis.
-- Escopo: enum de status + reason code terminal em trading_auto_runs.

DO $$
BEGIN
  ALTER TYPE "public"."trading_auto_run_status" ADD VALUE IF NOT EXISTS 'no_trade';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TYPE "public"."trading_auto_run_status" ADD VALUE IF NOT EXISTS 'blocked';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "trading_auto_runs"
  ADD COLUMN IF NOT EXISTS "terminal_reason_code" varchar(64);

CREATE INDEX IF NOT EXISTS "idx_trading_auto_runs_terminal_reason_code"
  ON "trading_auto_runs" ("terminal_reason_code")
  WHERE "terminal_reason_code" IS NOT NULL;
