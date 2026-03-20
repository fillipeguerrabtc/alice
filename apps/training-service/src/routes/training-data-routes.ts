import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, desc, eq, getDatabase, schema } from '@alice/database';
import {
  ResourceAccessError,
  assertAuthorizedResourceAccess,
  filterAccessibleResources,
  requirePermission,
} from '@alice/shared-utils';
import { z } from 'zod';

interface TenantResolutionSuccess {
  ok: true;
  tenantId: string;
  authContext: {
    userId: string | null;
  };
}

interface TenantResolutionError {
  ok: false;
  status: number;
  error: string;
}

type ResolveAuthorizedTenantIdFn = (
  req: Request,
  requestedTenantId?: string | null,
) => TenantResolutionSuccess | TenantResolutionError;

type TrainingHttpErrorResponse = {
  status: number;
  payload: unknown;
};

type TrainingDataStatus = 'pending' | 'approved' | 'rejected' | 'reserved' | 'used';
type TrainingDataPurpose = 'behavior_sft' | 'knowledge_rag' | 'eval_only' | 'rejected';

type ParseCollectTrainingDataBodyFn = (body: unknown) => {
  tenantId: string;
  [key: string]: unknown;
};

type ParseCollectTrainingDataPayloadFn = (payload: unknown) => {
  [key: string]: unknown;
};

interface RegisterTrainingDataRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  resolveAuthorizedTenantId: ResolveAuthorizedTenantIdFn;
  parseCollectTrainingDataBody: ParseCollectTrainingDataBodyFn;
  parseCollectTrainingDataPayload: ParseCollectTrainingDataPayloadFn;
  collectTrainingDataForTenant: (params: {
    tenantId: string;
    createdBy?: string;
    payload: Record<string, unknown>;
  }) => Promise<unknown>;
  toTrainingHttpErrorResponse: (error: unknown) => TrainingHttpErrorResponse | null;
  findNamespaceByIdInTenant: (tenantId: string, namespaceId: string) => Promise<{ id: string } | null | undefined>;
  findAgentByIdInTenant: (tenantId: string, agentId: string) => Promise<{ id: string; namespaceId: string | null } | null | undefined>;
  persistTrainingGovernanceAudit: (params: {
    tenantId: string;
    userId: string | null;
    action: 'training_scope_binding_changed';
    resource: 'training_data';
    resourceId: string;
    request: Request;
    details: Record<string, unknown>;
  }) => Promise<void>;
  incrementReviewMetric: (status: 'approved' | 'rejected') => void;
  incrementScopeOverrideMetric: (source: 'training_review' | 'quarantine_resolution') => void;
  incrementScopeResolvedMetric: (source: 'quarantine_resolution') => void;
  incrementGovernanceAuditWritesMetric: (result: 'success' | 'error') => void;
}

const trainingSourceTypeSchema = z.enum([
  'chat',
  'trading_signal',
  'trading_order',
  'trading_demo',
  'trading_postmortem',
  'document',
  'rag_document',
  'rag_media',
  'upload',
  'external',
  'manual',
  'system',
]);

const trainingDataQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'reserved', 'used']).optional(),
  namespaceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  inferredDomain: z.string().min(1).max(120).optional(),
  needsHumanReview: z.enum(['true', 'false']).optional(),
  sourceType: trainingSourceTypeSchema.optional(),
});

const uuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID valido'),
});

const statusUpdateSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  purpose: z.enum(['behavior_sft', 'knowledge_rag', 'eval_only']).optional(),
  reviewNotes: z.string().max(2000).optional(),
  overrideScope: z.object({
    namespaceId: z.string().uuid().optional().nullable(),
    agentId: z.string().uuid().optional().nullable(),
    domain: z.string().min(1).max(120).optional().nullable(),
    reason: z.string().min(10).max(2000),
  }).optional(),
});

const resolveScopeSchema = z.object({
  namespaceId: z.string().uuid(),
  agentId: z.string().uuid().optional().nullable(),
  domain: z.string().min(1).max(120).optional().nullable(),
  reason: z.string().min(10).max(2000),
});

export function registerTrainingDataRoutes(
  app: Express,
  deps: RegisterTrainingDataRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.post('/api/training/data', requirePermission('training:training_data:write'), async (req: Request, res: Response) => {
    try {
      const body = deps.parseCollectTrainingDataBody(req.body);
      const tenantResolution = deps.resolveAuthorizedTenantId(req, body.tenantId);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      const { tenantId: _tenantId, ...payload } = body;
      const result = await deps.collectTrainingDataForTenant({
        tenantId: tenantResolution.tenantId,
        createdBy: tenantResolution.authContext.userId ?? undefined,
        payload: deps.parseCollectTrainingDataPayload(payload),
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Payload invalido', details: error.flatten() });
      }
      const trainingHttpError = deps.toTrainingHttpErrorResponse(error);
      if (trainingHttpError) {
        return res.status(trainingHttpError.status).json(trainingHttpError.payload);
      }
      logger.error({ error }, 'Falha ao coletar dados de treinamento');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.get('/api/training/data', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
    const queryResult = trainingDataQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: 'Parametros invalidos', details: queryResult.error.format() });
    }
    const { status, namespaceId, agentId, inferredDomain, needsHumanReview, sourceType } = queryResult.data;

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      const db = getDatabase();
      const conditions = [eq(schema.trainingData.tenantId, tenantResolution.tenantId)];
      if (status) conditions.push(eq(schema.trainingData.status, status as TrainingDataStatus));
      if (namespaceId) conditions.push(eq(schema.trainingData.namespaceId, namespaceId));
      if (agentId) conditions.push(eq(schema.trainingData.agentId, agentId));
      if (inferredDomain) conditions.push(eq(schema.trainingData.inferredDomain, inferredDomain));
      if (needsHumanReview) conditions.push(eq(schema.trainingData.needsHumanReview, needsHumanReview === 'true'));
      if (sourceType) conditions.push(eq(schema.trainingData.sourceType, sourceType));

      const trainingData = await db.query.trainingData.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: [desc(schema.trainingData.criadoEm)],
        limit: 100,
      });

      const filteredTrainingData = await filterAccessibleResources({
        actor: {
          ...req.user,
          tenantId: tenantResolution.tenantId,
        },
        tenantId: tenantResolution.tenantId,
        resourceType: 'training_data',
        permission: 'read',
        resources: trainingData,
        db,
      });

      return res.json({ trainingData: filteredTrainingData });
    } catch (error) {
      if (error instanceof ResourceAccessError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      logger.error({ error }, 'Falha ao buscar dados de treinamento');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.patch('/api/training/data/:id/status', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
    const paramsResult = uuidParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return res.status(400).json({ error: 'ID invalido', details: paramsResult.error.format() });
    }
    const bodyResult = statusUpdateSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({ error: 'Status invalido', details: bodyResult.error.format() });
    }
    const { status, purpose, reviewNotes, overrideScope } = bodyResult.data;
    const tenantResolution = deps.resolveAuthorizedTenantId(req);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const reviewedBy = tenantResolution.authContext.userId;
    const db = getDatabase();

    try {
      await assertAuthorizedResourceAccess({
        actor: {
          ...req.user,
          tenantId: tenantResolution.tenantId,
        },
        resourceType: 'training_data',
        resourceId: paramsResult.data.id,
        permission: 'manage',
        tenantId: tenantResolution.tenantId,
        db,
      });

      const existing = await db.query.trainingData.findFirst({
        where: eq(schema.trainingData.id, paramsResult.data.id),
      });

      if (!existing) {
        return res.status(404).json({ error: 'Registro de treinamento nao encontrado' });
      }

      if (existing.tenantId !== tenantResolution.tenantId) {
        return res.status(403).json({ error: 'Registro de treinamento nao pertence ao tenant autenticado' });
      }

      if (!existing.namespaceId && status === 'approved' && !overrideScope?.namespaceId) {
        return res.status(400).json({
          error: 'Nao e possivel aprovar sem namespace definido. Resolva o escopo primeiro.',
        });
      }

      if (existing.needsHumanReview && status === 'approved' && !overrideScope) {
        return res.status(400).json({
          error: 'Item em quarentena de escopo. Resolva o escopo antes de aprovar.',
        });
      }

      let nextNamespaceId = existing.namespaceId;
      let nextAgentId = existing.agentId;
      let nextDomain = existing.inferredDomain;
      const overrideApplied =
        Boolean(overrideScope)
        && (
          (overrideScope?.namespaceId ?? existing.namespaceId) !== existing.namespaceId
          || (overrideScope?.agentId ?? existing.agentId) !== existing.agentId
          || (overrideScope?.domain ?? existing.inferredDomain) !== existing.inferredDomain
        );

      if (overrideScope) {
        if (!existing.tenantId) {
          return res.status(400).json({ error: 'Item sem tenant valido nao pode receber override de escopo' });
        }
        if (!overrideScope.reason?.trim()) {
          return res.status(400).json({ error: 'Motivo e obrigatorio para override de escopo' });
        }

        if (overrideScope.namespaceId) {
          const namespace = await deps.findNamespaceByIdInTenant(existing.tenantId, overrideScope.namespaceId);
          if (!namespace) {
            return res.status(403).json({ error: 'Namespace de override invalido para o tenant do item' });
          }
          nextNamespaceId = namespace.id;
        }

        if (overrideScope.agentId) {
          const agent = await deps.findAgentByIdInTenant(existing.tenantId, overrideScope.agentId);
          if (!agent) {
            return res.status(403).json({ error: 'Agente de override invalido para o tenant do item' });
          }
          if (nextNamespaceId && agent.namespaceId && agent.namespaceId !== nextNamespaceId) {
            return res.status(403).json({ error: 'Agente selecionado nao pertence ao namespace alvo' });
          }
          nextAgentId = agent.id;
          if (!nextNamespaceId && agent.namespaceId) {
            nextNamespaceId = agent.namespaceId;
          }
        }

        if (overrideScope.domain) {
          nextDomain = overrideScope.domain;
        }

        if (overrideApplied && reviewedBy) {
          await db.insert(schema.trainingScopeOverrides).values({
            trainingDataId: paramsResult.data.id,
            tenantId: existing.tenantId,
            oldNamespaceId: existing.namespaceId,
            newNamespaceId: nextNamespaceId,
            oldDomain: existing.inferredDomain,
            newDomain: nextDomain,
            oldAgentId: existing.agentId,
            newAgentId: nextAgentId,
            changedBy: reviewedBy,
            reason: overrideScope.reason,
            source: 'training_review',
          });
          deps.incrementScopeOverrideMetric('training_review');
          try {
            await deps.persistTrainingGovernanceAudit({
              tenantId: existing.tenantId,
              userId: reviewedBy,
              action: 'training_scope_binding_changed',
              resource: 'training_data',
              resourceId: existing.id,
              request: req,
              details: {
                source: 'training_review',
                reason: overrideScope.reason,
                oldScope: {
                  namespaceId: existing.namespaceId,
                  agentId: existing.agentId,
                  domain: existing.inferredDomain,
                },
                newScope: {
                  namespaceId: nextNamespaceId,
                  agentId: nextAgentId,
                  domain: nextDomain,
                },
              },
            });
            deps.incrementGovernanceAuditWritesMetric('success');
          } catch (auditError) {
            logger.warn({ auditError, trainingDataId: existing.id }, 'Falha ao registrar auditoria de mudanca de escopo');
            deps.incrementGovernanceAuditWritesMetric('error');
          }
        }
      }

      const reviewedAt = new Date();
      const nextPurpose: TrainingDataPurpose = status === 'rejected'
        ? 'rejected'
        : (purpose ?? (existing.purpose as TrainingDataPurpose));

      const [updated] = await db.update(schema.trainingData)
        .set({
          status: status as 'approved' | 'rejected',
          purpose: nextPurpose,
          processadoEm: reviewedAt,
          processedAt: reviewedAt,
          reviewedBy,
          reviewedAt,
          reviewNotes: reviewNotes ?? null,
          namespaceId: nextNamespaceId,
          agentId: nextAgentId,
          inferredDomain: nextDomain,
          needsHumanReview: false,
          quarantineReason: null,
          quarantinedAt: null,
        })
        .where(and(
          eq(schema.trainingData.id, paramsResult.data.id),
          eq(schema.trainingData.tenantId, tenantResolution.tenantId),
        ))
        .returning();

      deps.incrementReviewMetric(status);
      logger.info({ trainingDataId: paramsResult.data.id, status, overrideApplied }, 'Status de treinamento atualizado');
      return res.json({ trainingData: updated });
    } catch (error) {
      if (error instanceof ResourceAccessError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      logger.error({ error }, 'Falha ao atualizar status de treinamento');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.patch('/api/training/data/:id/resolve-scope', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
    const paramsResult = uuidParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return res.status(400).json({ error: 'ID invalido', details: paramsResult.error.format() });
    }
    const bodyResult = resolveScopeSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({ error: 'Payload invalido', details: bodyResult.error.format() });
    }

    const tenantResolution = deps.resolveAuthorizedTenantId(req);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const changedBy = tenantResolution.authContext.userId;
    if (!changedBy) {
      return res.status(403).json({ error: 'Usuario nao identificado para resolver escopo' });
    }
    const db = getDatabase();

    try {
      await assertAuthorizedResourceAccess({
        actor: {
          ...req.user,
          tenantId: tenantResolution.tenantId,
        },
        resourceType: 'training_data',
        resourceId: paramsResult.data.id,
        permission: 'manage',
        tenantId: tenantResolution.tenantId,
        db,
      });

      const existing = await db.query.trainingData.findFirst({
        where: eq(schema.trainingData.id, paramsResult.data.id),
      });
      if (!existing) {
        return res.status(404).json({ error: 'Registro de treinamento nao encontrado' });
      }
      if (existing.tenantId !== tenantResolution.tenantId) {
        return res.status(403).json({ error: 'Registro de treinamento nao pertence ao tenant autenticado' });
      }
      if (!existing.tenantId) {
        return res.status(400).json({ error: 'Item sem tenant valido nao pode ser resolvido' });
      }

      const namespace = await deps.findNamespaceByIdInTenant(existing.tenantId, bodyResult.data.namespaceId);
      if (!namespace) {
        return res.status(403).json({ error: 'Namespace nao pertence ao tenant do item' });
      }

      const nextAgentId: string | null = bodyResult.data.agentId ?? null;
      if (nextAgentId) {
        const agent = await deps.findAgentByIdInTenant(existing.tenantId, nextAgentId);
        if (!agent) {
          return res.status(403).json({ error: 'Agente invalido para o tenant do item' });
        }
        if (agent.namespaceId && agent.namespaceId !== namespace.id) {
          return res.status(403).json({ error: 'Agente nao pertence ao namespace informado' });
        }
      }

      await db.insert(schema.trainingScopeOverrides).values({
        trainingDataId: existing.id,
        tenantId: existing.tenantId,
        oldNamespaceId: existing.namespaceId,
        newNamespaceId: namespace.id,
        oldDomain: existing.inferredDomain,
        newDomain: bodyResult.data.domain ?? existing.inferredDomain,
        oldAgentId: existing.agentId,
        newAgentId: nextAgentId,
        changedBy,
        reason: bodyResult.data.reason,
        source: 'quarantine_resolution',
      });
      deps.incrementScopeOverrideMetric('quarantine_resolution');
      deps.incrementScopeResolvedMetric('quarantine_resolution');

      try {
        await deps.persistTrainingGovernanceAudit({
          tenantId: existing.tenantId,
          userId: changedBy,
          action: 'training_scope_binding_changed',
          resource: 'training_data',
          resourceId: existing.id,
          request: req,
          details: {
            source: 'quarantine_resolution',
            reason: bodyResult.data.reason,
            oldScope: {
              namespaceId: existing.namespaceId,
              agentId: existing.agentId,
              domain: existing.inferredDomain,
            },
            newScope: {
              namespaceId: namespace.id,
              agentId: nextAgentId,
              domain: bodyResult.data.domain ?? existing.inferredDomain,
            },
          },
        });
        deps.incrementGovernanceAuditWritesMetric('success');
      } catch (auditError) {
        logger.warn({ auditError, trainingDataId: existing.id }, 'Falha ao registrar auditoria de resolucao de escopo');
        deps.incrementGovernanceAuditWritesMetric('error');
      }

      const [updated] = await db.update(schema.trainingData)
        .set({
          namespaceId: namespace.id,
          agentId: nextAgentId,
          inferredDomain: bodyResult.data.domain ?? existing.inferredDomain,
          needsHumanReview: false,
          quarantineReason: null,
          quarantinedAt: null,
          scopeResolvedAt: new Date(),
          reviewedBy: changedBy,
          reviewedAt: new Date(),
        })
        .where(and(
          eq(schema.trainingData.id, existing.id),
          eq(schema.trainingData.tenantId, tenantResolution.tenantId),
        ))
        .returning();

      return res.json({ trainingData: updated });
    } catch (error) {
      if (error instanceof ResourceAccessError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      logger.error({ error }, 'Falha ao resolver escopo em quarentena');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  logger.info('Training data routes registered');
}
