-- Migration: Trading Auto Engine
-- Tabelas para rastrear execuções automáticas (pipeline institucional de portfólio e sinais IA)
-- Ref: CLAUDE.md Regra 6 (Enterprise-grade), Regra 7 (Mudanças cirúrgicas)

-- Enums
DO $$ BEGIN
  CREATE TYPE "public"."trading_auto_run_type" AS ENUM ('signal_auto', 'portfolio_auto');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."trading_auto_run_status" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."trading_auto_step_name" AS ENUM ('universe-scan', 'backtest', 'calibration', 'model-risk', 'rebalance', 'signal-decision');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."trading_auto_step_status" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- trading_auto_runs: rastreia execuções "Auto"
CREATE TABLE IF NOT EXISTS "trading_auto_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "user_id" uuid NOT NULL,
  "run_type" "trading_auto_run_type" NOT NULL,
  "status" "trading_auto_run_status" NOT NULL DEFAULT 'queued',
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "correlation_id" varchar(64),
  "namespace_id" uuid,
  "error" text,
  "started_at" timestamp,
  "finished_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- trading_auto_run_steps: etapas por run
CREATE TABLE IF NOT EXISTS "trading_auto_run_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "trading_auto_runs"("id") ON DELETE CASCADE,
  "step_name" "trading_auto_step_name" NOT NULL,
  "status" "trading_auto_step_status" NOT NULL DEFAULT 'pending',
  "metrics" jsonb DEFAULT '{}'::jsonb,
  "error" text,
  "started_at" timestamp,
  "ended_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- trading_auto_decisions: decisões finais
CREATE TABLE IF NOT EXISTS "trading_auto_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "trading_auto_runs"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "decision_type" "trading_auto_run_type" NOT NULL,
  "entry_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "exit_payload" jsonb DEFAULT '{}'::jsonb,
  "guardrails" jsonb DEFAULT '{}'::jsonb,
  "estimated_costs" jsonb DEFAULT '{}'::jsonb,
  "slippage_estimate" jsonb DEFAULT '{}'::jsonb,
  "candidate_ids" jsonb DEFAULT '[]'::jsonb,
  "models_used" jsonb DEFAULT '[]'::jsonb,
  "rag_evidence_ids" jsonb DEFAULT '[]'::jsonb,
  "idempotency_hash" varchar(128),
  "approved" boolean NOT NULL DEFAULT false,
  "reasoning" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Índices para queries frequentes
CREATE INDEX IF NOT EXISTS "idx_trading_auto_runs_tenant_type" ON "trading_auto_runs" ("tenant_id", "run_type");
CREATE INDEX IF NOT EXISTS "idx_trading_auto_runs_status" ON "trading_auto_runs" ("status");
CREATE INDEX IF NOT EXISTS "idx_trading_auto_run_steps_run_id" ON "trading_auto_run_steps" ("run_id");
CREATE INDEX IF NOT EXISTS "idx_trading_auto_decisions_run_id" ON "trading_auto_decisions" ("run_id");
CREATE INDEX IF NOT EXISTS "idx_trading_auto_decisions_tenant" ON "trading_auto_decisions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_trading_auto_decisions_idempotency" ON "trading_auto_decisions" ("idempotency_hash") WHERE "idempotency_hash" IS NOT NULL;

-- RLS (Row Level Security) para multi-tenancy
ALTER TABLE "trading_auto_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trading_auto_run_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trading_auto_decisions" ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
DO $$ BEGIN
  CREATE POLICY "trading_auto_runs_tenant_isolation" ON "trading_auto_runs"
    FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "trading_auto_decisions_tenant_isolation" ON "trading_auto_decisions"
    FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
