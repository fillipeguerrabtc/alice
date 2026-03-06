-- ============================================================================
-- MIGRACAO: Unicidade ativa de fingerprint para training_data
-- Objetivo:
-- 1) normalizar duplicidades ativas historicas (pending/approved/used)
-- 2) garantir idempotencia concorrente via unique index parcial
--
-- Author: Fillipe Guerra
-- Data: 06 de Marco de 2026
-- ============================================================================

WITH active_ranked AS (
  SELECT
    td.id,
    first_value(td.id) OVER (
      PARTITION BY td.tenant_id, td.source_type, td.semhash, COALESCE(td.source_id, '')
      ORDER BY
        CASE td.status
          WHEN 'used' THEN 0
          WHEN 'approved' THEN 1
          WHEN 'pending' THEN 2
          ELSE 3
        END,
        td.criado_em DESC,
        td.id DESC
    ) AS canonical_id,
    row_number() OVER (
      PARTITION BY td.tenant_id, td.source_type, td.semhash, COALESCE(td.source_id, '')
      ORDER BY
        CASE td.status
          WHEN 'used' THEN 0
          WHEN 'approved' THEN 1
          WHEN 'pending' THEN 2
          ELSE 3
        END,
        td.criado_em DESC,
        td.id DESC
    ) AS rank_position
  FROM training_data td
  WHERE td.tenant_id IS NOT NULL
    AND td.source_type IS NOT NULL
    AND td.semhash IS NOT NULL
    AND td.status IN ('pending', 'approved', 'used')
),
duplicates_to_normalize AS (
  SELECT
    id AS duplicate_id,
    canonical_id
  FROM active_ranked
  WHERE rank_position > 1
)
UPDATE training_data td
SET
  status = 'rejected',
  is_duplicate = true,
  duplicate_of_id = dtn.canonical_id,
  similarity_score = 1,
  review_notes = CONCAT_WS(
    ' | ',
    NULLIF(td.review_notes, ''),
    'Normalizado pela migracao 0100: duplicidade ativa de fingerprint'
  ),
  processed_at = COALESCE(td.processed_at, td.processado_em, NOW()),
  processado_em = COALESCE(td.processado_em, td.processed_at, NOW())
FROM duplicates_to_normalize dtn
WHERE td.id = dtn.duplicate_id;

CREATE UNIQUE INDEX IF NOT EXISTS training_data_active_fingerprint_uidx
  ON training_data (tenant_id, source_type, semhash, COALESCE(source_id, ''))
  WHERE tenant_id IS NOT NULL
    AND semhash IS NOT NULL
    AND status IN ('pending', 'approved', 'used');
