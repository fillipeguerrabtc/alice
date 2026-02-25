-- Migration: Trading Auto Signal link + novos steps de Auto Engine
-- Ref: Sinais IA (Auto) com persistência unificada em trading_signals

DO $$ BEGIN
  ALTER TYPE "public"."trading_auto_step_name" ADD VALUE IF NOT EXISTS 'signal-llm';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "public"."trading_auto_step_name" ADD VALUE IF NOT EXISTS 'signal-persist';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "trading_auto_decisions"
  ADD COLUMN IF NOT EXISTS "trading_signal_id" uuid;

DO $$ BEGIN
  ALTER TABLE "trading_auto_decisions"
    ADD CONSTRAINT "trading_auto_decisions_trading_signal_id_trading_signals_id_fk"
    FOREIGN KEY ("trading_signal_id") REFERENCES "public"."trading_signals"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
