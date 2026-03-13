-- 0110_trading_signal_promotion_path.sql
-- Objetivo: criar lifecycle auditável de promotion path para sinais de trading
-- Escopo: lineage de evidence -> dataset -> calibration -> demo eligibility -> real eligibility

DO $$
BEGIN
  CREATE TYPE "public"."trading_signal_promotion_stage" AS ENUM (
    'candidate_evidence_captured',
    'dataset_candidate',
    'approved_dataset_version',
    'calibration_result',
    'demo_eligible',
    'real_eligible'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "public"."trading_signal_eligibility_status" AS ENUM (
    'pending',
    'eligible',
    'blocked'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "public"."trading_signal_promotion_validation_state" AS ENUM (
    'pending',
    'validated',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "trading_signal_promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "signal_id" uuid NOT NULL REFERENCES "trading_signals"("id") ON DELETE CASCADE,
  "auto_run_id" uuid,
  "auto_decision_id" uuid,
  "evidence_source_type" varchar(64) NOT NULL DEFAULT 'signal',
  "evidence_source_id" varchar(255) NOT NULL,
  "lifecycle_stage" "trading_signal_promotion_stage" NOT NULL DEFAULT 'candidate_evidence_captured',
  "validation_state" "trading_signal_promotion_validation_state" NOT NULL DEFAULT 'pending',
  "dataset_candidate_id" uuid REFERENCES "training_data"("id") ON DELETE SET NULL,
  "dataset_version_id" uuid REFERENCES "training_dataset_versions"("id") ON DELETE SET NULL,
  "calibration_id" uuid REFERENCES "trading_signal_calibration"("id") ON DELETE SET NULL,
  "demo_eligibility_status" "trading_signal_eligibility_status" NOT NULL DEFAULT 'pending',
  "demo_eligibility_reason_code" varchar(64),
  "demo_order_id" uuid,
  "demo_promoted_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "demo_promoted_at" timestamp,
  "demo_promotion_reason" text,
  "real_eligibility_status" "trading_signal_eligibility_status" NOT NULL DEFAULT 'pending',
  "real_eligibility_reason_code" varchar(64),
  "real_promoted_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "real_promoted_at" timestamp,
  "real_promotion_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_trading_signal_promotions_tenant_signal"
  ON "trading_signal_promotions" ("tenant_id", "signal_id");

CREATE INDEX IF NOT EXISTS "idx_trading_signal_promotions_tenant"
  ON "trading_signal_promotions" ("tenant_id");

CREATE INDEX IF NOT EXISTS "idx_trading_signal_promotions_stage"
  ON "trading_signal_promotions" ("lifecycle_stage");

CREATE INDEX IF NOT EXISTS "idx_trading_signal_promotions_demo_eligibility"
  ON "trading_signal_promotions" ("demo_eligibility_status");

CREATE INDEX IF NOT EXISTS "idx_trading_signal_promotions_real_eligibility"
  ON "trading_signal_promotions" ("real_eligibility_status");

CREATE INDEX IF NOT EXISTS "idx_trading_signal_promotions_dataset_candidate"
  ON "trading_signal_promotions" ("dataset_candidate_id");

CREATE TABLE IF NOT EXISTS "trading_signal_promotion_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "promotion_path_id" uuid NOT NULL REFERENCES "trading_signal_promotions"("id") ON DELETE CASCADE,
  "signal_id" uuid NOT NULL REFERENCES "trading_signals"("id") ON DELETE CASCADE,
  "lifecycle_stage" "trading_signal_promotion_stage" NOT NULL,
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "reason" text,
  "evidence_source_type" varchar(64) NOT NULL,
  "evidence_source_id" varchar(255) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_trading_signal_promotion_events_tenant"
  ON "trading_signal_promotion_events" ("tenant_id");

CREATE INDEX IF NOT EXISTS "idx_trading_signal_promotion_events_signal"
  ON "trading_signal_promotion_events" ("signal_id");

CREATE INDEX IF NOT EXISTS "idx_trading_signal_promotion_events_path"
  ON "trading_signal_promotion_events" ("promotion_path_id");

CREATE INDEX IF NOT EXISTS "idx_trading_signal_promotion_events_stage"
  ON "trading_signal_promotion_events" ("lifecycle_stage");

CREATE INDEX IF NOT EXISTS "idx_trading_signal_promotion_events_created_at"
  ON "trading_signal_promotion_events" ("created_at");
