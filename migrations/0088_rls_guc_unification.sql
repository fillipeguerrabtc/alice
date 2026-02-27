-- Migration: 0088_rls_guc_unification
-- Objetivo: unificar policies RLS para usar current_tenant_id() (SSOT)
-- e remover dependencia de current_setting('app.tenant_id', true)

DO $$
BEGIN
  -- 0012_technical_indicators.sql
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trading_technical_indicators' AND policyname = 'trading_indicators_select_policy'
  ) THEN
    EXECUTE 'ALTER POLICY trading_indicators_select_policy ON trading_technical_indicators USING (tenant_id = current_tenant_id())';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trading_technical_indicators' AND policyname = 'trading_indicators_insert_policy'
  ) THEN
    EXECUTE 'ALTER POLICY trading_indicators_insert_policy ON trading_technical_indicators WITH CHECK (tenant_id = current_tenant_id())';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trading_technical_indicators' AND policyname = 'trading_indicators_update_policy'
  ) THEN
    EXECUTE 'ALTER POLICY trading_indicators_update_policy ON trading_technical_indicators USING (tenant_id = current_tenant_id())';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trading_technical_indicators' AND policyname = 'trading_indicators_delete_policy'
  ) THEN
    EXECUTE 'ALTER POLICY trading_indicators_delete_policy ON trading_technical_indicators USING (tenant_id = current_tenant_id())';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trading_llm_validations' AND policyname = 'llm_validations_select_policy'
  ) THEN
    EXECUTE 'ALTER POLICY llm_validations_select_policy ON trading_llm_validations USING (tenant_id = current_tenant_id())';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trading_llm_validations' AND policyname = 'llm_validations_insert_policy'
  ) THEN
    EXECUTE 'ALTER POLICY llm_validations_insert_policy ON trading_llm_validations WITH CHECK (tenant_id = current_tenant_id())';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trading_llm_validations' AND policyname = 'llm_validations_update_policy'
  ) THEN
    EXECUTE 'ALTER POLICY llm_validations_update_policy ON trading_llm_validations USING (tenant_id = current_tenant_id())';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trading_llm_validations' AND policyname = 'llm_validations_delete_policy'
  ) THEN
    EXECUTE 'ALTER POLICY llm_validations_delete_policy ON trading_llm_validations USING (tenant_id = current_tenant_id())';
  END IF;

  -- 0056_demo_trading_snapshot_postmortem.sql
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trading_snapshots' AND policyname = 'trading_snapshots_tenant_isolation'
  ) THEN
    EXECUTE 'ALTER POLICY trading_snapshots_tenant_isolation ON trading_snapshots USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trading_postmortems' AND policyname = 'trading_postmortems_tenant_isolation'
  ) THEN
    EXECUTE 'ALTER POLICY trading_postmortems_tenant_isolation ON trading_postmortems USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'demo_balances' AND policyname = 'demo_balances_tenant_isolation'
  ) THEN
    EXECUTE 'ALTER POLICY demo_balances_tenant_isolation ON demo_balances USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'demo_fund_history' AND policyname = 'demo_fund_history_tenant_isolation'
  ) THEN
    EXECUTE 'ALTER POLICY demo_fund_history_tenant_isolation ON demo_fund_history USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'demo_orders' AND policyname = 'demo_orders_tenant_isolation'
  ) THEN
    EXECUTE 'ALTER POLICY demo_orders_tenant_isolation ON demo_orders USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'demo_positions' AND policyname = 'demo_positions_tenant_isolation'
  ) THEN
    EXECUTE 'ALTER POLICY demo_positions_tenant_isolation ON demo_positions USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())';
  END IF;

  -- 0057_training_scope_governance.sql
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'training_dataset_profiles' AND policyname = 'training_dataset_profiles_tenant_isolation'
  ) THEN
    EXECUTE 'ALTER POLICY training_dataset_profiles_tenant_isolation ON training_dataset_profiles USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'training_scope_overrides' AND policyname = 'training_scope_overrides_tenant_isolation'
  ) THEN
    EXECUTE 'ALTER POLICY training_scope_overrides_tenant_isolation ON training_scope_overrides USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())';
  END IF;

  -- 0083_trading_auto_engine.sql
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trading_auto_runs' AND policyname = 'trading_auto_runs_tenant_isolation'
  ) THEN
    EXECUTE 'ALTER POLICY trading_auto_runs_tenant_isolation ON trading_auto_runs USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trading_auto_decisions' AND policyname = 'trading_auto_decisions_tenant_isolation'
  ) THEN
    EXECUTE 'ALTER POLICY trading_auto_decisions_tenant_isolation ON trading_auto_decisions USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())';
  END IF;

  -- 0085_trading_guardrail_thresholds.sql
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trading_guardrail_thresholds' AND policyname = 'trading_guardrail_thresholds_tenant_isolation'
  ) THEN
    EXECUTE 'ALTER POLICY trading_guardrail_thresholds_tenant_isolation ON trading_guardrail_thresholds USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())';
  END IF;
END
$$;
