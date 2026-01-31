-- ============================================================================
-- MIGRATION: Training lineage, auditoria e deduplicação enterprise
-- Data: 31/01/2026
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'training_source_type') THEN
    CREATE TYPE training_source_type AS ENUM (
      'chat',
      'trading_signal',
      'trading_order',
      'document',
      'external',
      'manual',
      'system'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trading_dataset_source_type') THEN
    CREATE TYPE trading_dataset_source_type AS ENUM (
      'signal',
      'order',
      'manual',
      'system'
    );
  END IF;
END $$;

ALTER TABLE training_data
  ADD COLUMN IF NOT EXISTS source_type training_source_type NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_id varchar(255),
  ADD COLUMN IF NOT EXISTS source_metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS quality_score real,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp,
  ADD COLUMN IF NOT EXISTS review_notes text;

ALTER TABLE trading_dataset
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp,
  ADD COLUMN IF NOT EXISTS duplicate_of_id uuid,
  ADD COLUMN IF NOT EXISTS similarity_score real,
  ADD COLUMN IF NOT EXISTS source_type trading_dataset_source_type NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_id varchar(255),
  ADD COLUMN IF NOT EXISTS source_metadata jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_training_source_type ON training_data (source_type);
CREATE INDEX IF NOT EXISTS idx_training_source_id ON training_data (source_id);
CREATE INDEX IF NOT EXISTS idx_trading_dataset_source_type ON trading_dataset (source_type);
CREATE INDEX IF NOT EXISTS idx_trading_dataset_source_id ON trading_dataset (source_id);
