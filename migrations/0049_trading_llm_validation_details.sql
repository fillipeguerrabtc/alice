BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'llm_validation_reason') THEN
    CREATE TYPE llm_validation_reason AS ENUM ('ok', 'no_values', 'discrepancy');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'llm_validation_extraction_source') THEN
    CREATE TYPE llm_validation_extraction_source AS ENUM ('llm_payload', 'regex');
  END IF;
END $$;

ALTER TABLE trading_llm_validations
  ADD COLUMN IF NOT EXISTS failure_reason llm_validation_reason,
  ADD COLUMN IF NOT EXISTS extraction_source llm_validation_extraction_source,
  ADD COLUMN IF NOT EXISTS no_values_extracted boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS overall_accuracy real,
  ADD COLUMN IF NOT EXISTS failed_fields text[],
  ADD COLUMN IF NOT EXISTS timeframe_used varchar(10),
  ADD COLUMN IF NOT EXISTS allowed_deviation_by_field jsonb,
  ADD COLUMN IF NOT EXISTS max_deviation_found real;

UPDATE trading_llm_validations
SET no_values_extracted = COALESCE(
  no_values_extracted,
  (
    SELECT count(*) = 0
    FROM jsonb_object_keys(COALESCE(llm_cited_values, '{}'::jsonb))
  )
)
WHERE no_values_extracted IS NULL;

UPDATE trading_llm_validations
SET failure_reason = COALESCE(
  failure_reason,
  CASE
    WHEN validation_passed THEN 'ok'::llm_validation_reason
    WHEN (
      SELECT count(*) = 0
      FROM jsonb_object_keys(COALESCE(llm_cited_values, '{}'::jsonb))
    ) THEN 'no_values'::llm_validation_reason
    ELSE 'discrepancy'::llm_validation_reason
  END
)
WHERE failure_reason IS NULL;

UPDATE trading_llm_validations
SET extraction_source = COALESCE(extraction_source, 'regex'::llm_validation_extraction_source)
WHERE extraction_source IS NULL;

UPDATE trading_llm_validations v
SET failed_fields = sub.failed_fields
FROM (
  SELECT id, array_agg(key) AS failed_fields
  FROM trading_llm_validations, jsonb_object_keys(discrepancies) AS key
  WHERE discrepancies IS NOT NULL
  GROUP BY id
) AS sub
WHERE v.id = sub.id AND v.failed_fields IS NULL;

UPDATE trading_llm_validations v
SET max_deviation_found = sub.max_diff
FROM (
  SELECT id, max((value->>'diff')::float) AS max_diff
  FROM trading_llm_validations, jsonb_each(discrepancies) AS d(key, value)
  WHERE discrepancies IS NOT NULL
  GROUP BY id
) AS sub
WHERE v.id = sub.id AND v.max_deviation_found IS NULL;

COMMIT;
