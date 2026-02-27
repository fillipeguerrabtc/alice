-- Migration: 0089_trading_auto_run_steps_rls_policy
-- Objetivo: adicionar policy RLS faltante em trading_auto_run_steps
-- mantendo isolamento por tenant via relacionamento com trading_auto_runs.

ALTER TABLE "trading_auto_run_steps" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trading_auto_run_steps'
      AND policyname = 'trading_auto_run_steps_tenant_isolation'
  ) THEN
    EXECUTE '
      CREATE POLICY trading_auto_run_steps_tenant_isolation
      ON trading_auto_run_steps
      FOR ALL
      USING (
        EXISTS (
          SELECT 1
          FROM trading_auto_runs r
          WHERE r.id = trading_auto_run_steps.run_id
            AND r.tenant_id = current_tenant_id()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM trading_auto_runs r
          WHERE r.id = trading_auto_run_steps.run_id
            AND r.tenant_id = current_tenant_id()
        )
      )
    ';
  END IF;
END
$$;
