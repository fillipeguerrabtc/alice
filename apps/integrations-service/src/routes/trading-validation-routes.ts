import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, desc, eq, getDatabase, schema, sql, withTenantContext } from '@alice/database';
import { extractAuthContext, requirePermission } from '@alice/shared-utils';

function parseHistoryDateParam(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

interface RegisterTradingValidationRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
}

export function registerTradingValidationRoutes(
  app: Express,
  deps: RegisterTradingValidationRoutesDeps = {},
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations/trading/validations', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
      const passedOnly = req.query.passedOnly === 'true';
      const db = getDatabase();

      const conditions = [eq(schema.tradingLlmValidations.tenantId, authContext.tenantId)];
      if (passedOnly) {
        conditions.push(eq(schema.tradingLlmValidations.validationPassed, true));
      }

      const validations = await db
        .select()
        .from(schema.tradingLlmValidations)
        .where(and(...conditions))
        .orderBy(desc(schema.tradingLlmValidations.validatedAt))
        .limit(limit);

      const statsResult = await db
        .select({
          total: sql<number>`count(*)::int`,
          passed: sql<number>`sum(case when ${schema.tradingLlmValidations.validationPassed} = true then 1 else 0 end)::int`,
        })
        .from(schema.tradingLlmValidations)
        .where(eq(schema.tradingLlmValidations.tenantId, authContext.tenantId));

      const totalValidations = statsResult[0]?.total ?? 0;
      const passedValidations = statsResult[0]?.passed ?? 0;
      const accuracyRate = totalValidations > 0 ? (passedValidations / totalValidations) * 100 : 0;

      res.json({
        success: true,
        data: validations,
        stats: {
          total: totalValidations,
          passed: passedValidations,
          failed: totalValidations - passedValidations,
          accuracyRate: Math.round(accuracyRate * 100) / 100,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter validações LLM');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/validations/diagnostics', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const dateFromRaw = req.query.dateFrom as string | undefined;
      const dateToRaw = req.query.dateTo as string | undefined;
      const dateFrom = parseHistoryDateParam(dateFromRaw);
      const dateTo = parseHistoryDateParam(dateToRaw);
      if (dateFromRaw && !dateFrom) {
        res.status(400).json({ error: 'Data inicial inválida.' });
        return;
      }
      if (dateToRaw && !dateTo) {
        res.status(400).json({ error: 'Data final inválida.' });
        return;
      }
      const topLimit = Math.min(Number.parseInt(req.query.topLimit as string, 10) || 10, 50);

      const result = await withTenantContext(authContext.tenantId, authContext.role === 'super_admin', async (tx) => {
        const conditions: ReturnType<typeof sql>[] = [
          sql`v.tenant_id = ${authContext.tenantId}`,
        ];
        if (dateFrom) {
          conditions.push(sql`v.validated_at >= ${dateFrom}`);
        }
        if (dateTo) {
          conditions.push(sql`v.validated_at <= ${dateTo}`);
        }

        const whereClause = conditions.length
          ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
          : sql``;

        const totalsResult = await tx.execute(sql`
          SELECT
            count(*)::int AS total,
            sum(case when v.validation_passed then 1 else 0 end)::int AS passed,
            sum(case when not v.validation_passed then 1 else 0 end)::int AS failed,
            sum(case when coalesce(
              v.no_values_extracted,
              (
                SELECT count(*) = 0
                FROM jsonb_object_keys(COALESCE(v.llm_cited_values, '{}'::jsonb))
              )
            ) then 1 else 0 end)::int AS no_values,
            avg((
              SELECT count(*)
              FROM jsonb_object_keys(COALESCE(v.discrepancies, '{}'::jsonb))
            ))::float AS avg_discrepancy_fields,
            min(v.max_allowed_deviation)::float AS min_allowed_deviation,
            max(v.max_allowed_deviation)::float AS max_allowed_deviation
          FROM trading_llm_validations v
          ${whereClause}
        `);
        const totalsRow = (totalsResult as { rows?: Array<Record<string, unknown>> }).rows?.[0] ?? {};

        const actionResult = await tx.execute(sql`
          SELECT
            coalesce(v.action_taken::text, 'unknown') AS action,
            count(*)::int AS total
          FROM trading_llm_validations v
          ${whereClause}
          GROUP BY v.action_taken
          ORDER BY total DESC
        `);

        const failureReasonResult = await tx.execute(sql`
          SELECT
            coalesce(v.failure_reason::text, 'unknown') AS reason,
            count(*)::int AS total
          FROM trading_llm_validations v
          ${whereClause}
          GROUP BY v.failure_reason
          ORDER BY total DESC
        `);

        const extractionResult = await tx.execute(sql`
          SELECT
            coalesce(v.extraction_source::text, 'unknown') AS source,
            count(*)::int AS total
          FROM trading_llm_validations v
          ${whereClause}
          GROUP BY v.extraction_source
          ORDER BY total DESC
        `);

        const intervalResult = await tx.execute(sql`
          SELECT
            coalesce(ti.interval::text, 'N/A') AS interval,
            count(*)::int AS total,
            sum(case when v.validation_passed then 1 else 0 end)::int AS passed,
            sum(case when not v.validation_passed then 1 else 0 end)::int AS failed,
            sum(case when coalesce(
              v.no_values_extracted,
              (
                SELECT count(*) = 0
                FROM jsonb_object_keys(COALESCE(v.llm_cited_values, '{}'::jsonb))
              )
            ) then 1 else 0 end)::int AS no_values
          FROM trading_llm_validations v
          LEFT JOIN trading_technical_indicators ti ON ti.id = v.indicator_snapshot_id
          ${whereClause}
          GROUP BY ti.interval
          ORDER BY total DESC
        `);

        const symbolResult = await tx.execute(sql`
          SELECT
            coalesce(ti.symbol, 'N/A') AS symbol,
            count(*)::int AS total,
            sum(case when v.validation_passed then 1 else 0 end)::int AS passed,
            sum(case when not v.validation_passed then 1 else 0 end)::int AS failed
          FROM trading_llm_validations v
          LEFT JOIN trading_technical_indicators ti ON ti.id = v.indicator_snapshot_id
          ${whereClause}
          GROUP BY ti.symbol
          ORDER BY total DESC
          LIMIT ${topLimit}
        `);

        const discrepancyConditions = [
          ...conditions,
          sql`v.discrepancies is not null`,
        ];
        const discrepancyWhere = sql`WHERE ${sql.join(discrepancyConditions, sql` AND `)}`;

        const discrepancyResult = await tx.execute(sql`
          SELECT
            d.key AS field,
            count(*)::int AS occurrences,
            avg((d.value->>'diff')::float)::float AS avg_diff,
            max((d.value->>'diff')::float)::float AS max_diff
          FROM trading_llm_validations v
          CROSS JOIN LATERAL jsonb_each(v.discrepancies) AS d(key, value)
          ${discrepancyWhere}
          GROUP BY d.key
          ORDER BY occurrences DESC
          LIMIT ${topLimit}
        `);

        return {
          totalsRow,
          actionRows: (actionResult as { rows?: Array<Record<string, unknown>> }).rows ?? [],
          failureReasonRows: (failureReasonResult as { rows?: Array<Record<string, unknown>> }).rows ?? [],
          extractionRows: (extractionResult as { rows?: Array<Record<string, unknown>> }).rows ?? [],
          intervalRows: (intervalResult as { rows?: Array<Record<string, unknown>> }).rows ?? [],
          symbolRows: (symbolResult as { rows?: Array<Record<string, unknown>> }).rows ?? [],
          discrepancyRows: (discrepancyResult as { rows?: Array<Record<string, unknown>> }).rows ?? [],
        };
      });

      res.json({
        success: true,
        meta: {
          tenantId: authContext.tenantId,
          dateFrom: dateFrom ? dateFrom.toISOString() : null,
          dateTo: dateTo ? dateTo.toISOString() : null,
          topLimit,
        },
        totals: result.totalsRow,
        breakdown: {
          byAction: result.actionRows,
          byFailureReason: result.failureReasonRows,
          byExtractionSource: result.extractionRows,
          byInterval: result.intervalRows,
          bySymbol: result.symbolRows,
          topDiscrepancies: result.discrepancyRows,
        },
      });
    } catch (error) {
      const drizzleError = error as { message?: string; cause?: { code?: string; detail?: string; hint?: string; constraint?: string; message?: string } };
      const pgCause = drizzleError.cause;
      logger.error({
        message: drizzleError.message ?? 'Erro desconhecido',
        pgCode: pgCause?.code,
        pgMessage: pgCause?.message,
        pgDetail: pgCause?.detail,
        pgHint: pgCause?.hint,
        pgConstraint: pgCause?.constraint,
      }, 'Erro ao obter diagnóstico de validações LLM');
      const errorMessage = pgCause?.message ?? drizzleError.message ?? 'Erro desconhecido';
      res.status(500).json({ error: errorMessage });
    }
  });
}
