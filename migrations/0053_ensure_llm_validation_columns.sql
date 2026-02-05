DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'llm_validation_reason'
  ) THEN
    CREATE TYPE llm_validation_reason AS ENUM (
      'missing_values',
      'value_mismatch',
      'unclear_reasoning',
      'missing_citations',
      'unknown'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'llm_validation_extraction_source'
  ) THEN
    CREATE TYPE llm_validation_extraction_source AS ENUM (
      'llm_payload',
      'regex',
      'none'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'trading_llm_validations'
  ) THEN
    ALTER TABLE trading_llm_validations
      ADD COLUMN IF NOT EXISTS action_taken VARCHAR(50),
      ADD COLUMN IF NOT EXISTS failure_reason llm_validation_reason,
      ADD COLUMN IF NOT EXISTS extraction_source llm_validation_extraction_source,
      ADD COLUMN IF NOT EXISTS no_values_extracted BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS overall_accuracy REAL,
      ADD COLUMN IF NOT EXISTS failed_fields TEXT[],
      ADD COLUMN IF NOT EXISTS timeframe_used VARCHAR(10),
      ADD COLUMN IF NOT EXISTS allowed_deviation_by_field JSONB,
      ADD COLUMN IF NOT EXISTS max_deviation_found REAL;
  END IF;
END $$;
