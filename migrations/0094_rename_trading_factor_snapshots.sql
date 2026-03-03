-- Consolidacao Trading unico: remover sufixo legado _v2 da tabela de snapshots

DO $$
BEGIN
  IF to_regclass('public.trading_factor_snapshots_v2') IS NOT NULL
     AND to_regclass('public.trading_factor_snapshots') IS NULL THEN
    ALTER TABLE public.trading_factor_snapshots_v2 RENAME TO trading_factor_snapshots;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.uniq_trading_factor_snapshots_v2') IS NOT NULL
     AND to_regclass('public.uniq_trading_factor_snapshots') IS NULL THEN
    ALTER INDEX public.uniq_trading_factor_snapshots_v2 RENAME TO uniq_trading_factor_snapshots;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.idx_trading_factor_snapshots_v2_tenant_market') IS NOT NULL
     AND to_regclass('public.idx_trading_factor_snapshots_tenant_market') IS NULL THEN
    ALTER INDEX public.idx_trading_factor_snapshots_v2_tenant_market RENAME TO idx_trading_factor_snapshots_tenant_market;
  END IF;
END $$;
