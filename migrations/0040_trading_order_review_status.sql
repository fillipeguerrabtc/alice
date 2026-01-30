-- Adiciona status de revisão manual para ordens
-- Regra 6: persistência real em PostgreSQL
ALTER TYPE trading_order_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE trading_order_status ADD VALUE IF NOT EXISTS 'review_rejected';
