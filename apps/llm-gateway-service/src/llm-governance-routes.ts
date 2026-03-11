import type { NextFunction, Request, Response } from 'express';
import type express from 'express';
import { z } from 'zod';
import { asyncHandler } from '@alice/shared-utils';
import {
  activatePromptTemplate,
  activateToolPolicy,
  createPromptTemplate,
  createToolPolicy,
  getPromptTemplateApprovalSchema,
  getPromptTemplateActivateSchema,
  getPromptTemplateCreateSchema,
  getPromptTemplateEvaluateSchema,
  getToolPolicyActivateSchema,
  getToolPolicyApprovalSchema,
  getToolPolicyCreateSchema,
  listToolPolicyApprovals,
  listPromptTemplateApprovals,
  listPromptTemplates,
  listToolPolicies,
  recordPromptTemplateApproval,
  recordPromptTemplateEvaluation,
  recordToolPolicyApproval,
} from './governance.js';
import { resolveGovernanceActor } from './governance-auth.js';

type GovernanceLogger = {
  warn: (...args: unknown[]) => void;
};

const promptTemplateListQuerySchema = z.object({
  tenantId: z.string().uuid(),
  namespaceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  promptKey: z.string().min(1).max(128).optional(),
  status: z.enum(['draft', 'active', 'deprecated', 'archived']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const promptTemplateApprovalListQuerySchema = z.object({
  tenantId: z.string().uuid(),
});

const toolPolicyListQuerySchema = z.object({
  tenantId: z.string().uuid(),
  namespaceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  policyKey: z.string().min(1).max(120).optional(),
  status: z.enum(['draft', 'active', 'deprecated', 'archived']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const toolPolicyApprovalListQuerySchema = z.object({
  tenantId: z.string().uuid(),
});

function resolveGovernanceActorFromRequest(
  logger: GovernanceLogger,
  req: Request,
  res: Response,
  providedActorUserId?: string | null,
): string | null {
  const resolution = resolveGovernanceActor({
    authenticatedUserId: req.user?.userId ?? null,
    authenticatedRole: req.user?.role ?? null,
    providedActorUserId: providedActorUserId ?? null,
  });

  if (!resolution.ok) {
    logger.warn(
      {
        path: req.path,
        method: req.method,
        userId: req.user?.userId ?? null,
        role: req.user?.role ?? null,
        reason: resolution.code,
      },
      'Bloqueio de mutação de governança por trust policy'
    );
    res.status(resolution.status).json({ error: resolution.code, message: resolution.message });
    return null;
  }

  return resolution.actorUserId;
}

function requireGovernanceMutationAuth(logger: GovernanceLogger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const actorUserId = resolveGovernanceActorFromRequest(logger, req, res);
    if (!actorUserId) return;
    next();
  };
}

export function registerLlmGovernanceRoutes(params: {
  app: express.Express;
  logger: GovernanceLogger;
}): void {
  const { app, logger } = params;

  app.get(
    '/api/llm/governance/prompt-templates',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = promptTemplateListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
        return;
      }

      const rows = await listPromptTemplates(parsed.data);
      res.status(200).json({ templates: rows });
    })
  );

  app.post(
    '/api/llm/governance/prompt-templates',
    requireGovernanceMutationAuth(logger),
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = getPromptTemplateCreateSchema().safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Body inválido', details: parsed.error.flatten() });
        return;
      }

      const actorUserId = resolveGovernanceActorFromRequest(logger, req, res, parsed.data.createdBy ?? null);
      if (!actorUserId) return;

      const created = await createPromptTemplate({
        ...parsed.data,
        createdBy: actorUserId,
      });
      res.status(201).json(created);
    })
  );

  app.post(
    '/api/llm/governance/prompt-templates/:templateId/evaluate',
    requireGovernanceMutationAuth(logger),
    asyncHandler(async (req: Request, res: Response) => {
      const parsedBody = getPromptTemplateEvaluateSchema().safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({ error: 'Body inválido', details: parsedBody.error.flatten() });
        return;
      }

      const templateId = req.params.templateId;
      if (!templateId) {
        res.status(400).json({ error: 'templateId obrigatório' });
        return;
      }

      const actorUserId = resolveGovernanceActorFromRequest(logger, req, res, parsedBody.data.evaluatedBy ?? null);
      if (!actorUserId) return;

      try {
        const evaluation = await recordPromptTemplateEvaluation({
          templateId,
          ...parsedBody.data,
          evaluatedBy: actorUserId,
        });
        res.status(200).json(evaluation);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'PROMPT_TEMPLATE_EVALUATION_UPDATE_FAILED';
        if (message === 'PROMPT_TEMPLATE_NOT_FOUND') {
          res.status(404).json({ error: message });
          return;
        }
        throw error;
      }
    })
  );

  app.post(
    '/api/llm/governance/prompt-templates/:templateId/approval',
    requireGovernanceMutationAuth(logger),
    asyncHandler(async (req: Request, res: Response) => {
      const parsedBody = getPromptTemplateApprovalSchema().safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({ error: 'Body inválido', details: parsedBody.error.flatten() });
        return;
      }

      const templateId = req.params.templateId;
      if (!templateId) {
        res.status(400).json({ error: 'templateId obrigatório' });
        return;
      }

      const actorUserId = resolveGovernanceActorFromRequest(logger, req, res, parsedBody.data.approverUserId ?? null);
      if (!actorUserId) return;

      try {
        const summary = await recordPromptTemplateApproval({
          templateId,
          ...parsedBody.data,
          approverUserId: actorUserId,
        });
        res.status(200).json(summary);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'PROMPT_TEMPLATE_APPROVAL_UPDATE_FAILED';
        if (message === 'PROMPT_TEMPLATE_NOT_FOUND') {
          res.status(404).json({ error: message });
          return;
        }
        throw error;
      }
    })
  );

  app.get(
    '/api/llm/governance/prompt-templates/:templateId/approvals',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = promptTemplateApprovalListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
        return;
      }

      const templateId = req.params.templateId;
      if (!templateId) {
        res.status(400).json({ error: 'templateId obrigatório' });
        return;
      }

      try {
        const summary = await listPromptTemplateApprovals({
          tenantId: parsed.data.tenantId,
          templateId,
        });
        res.status(200).json(summary);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'PROMPT_TEMPLATE_APPROVALS_LIST_FAILED';
        if (message === 'PROMPT_TEMPLATE_NOT_FOUND') {
          res.status(404).json({ error: message });
          return;
        }
        throw error;
      }
    })
  );

  app.post(
    '/api/llm/governance/prompt-templates/:templateId/activate',
    requireGovernanceMutationAuth(logger),
    asyncHandler(async (req: Request, res: Response) => {
      const parsedBody = getPromptTemplateActivateSchema().safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({ error: 'Body inválido', details: parsedBody.error.flatten() });
        return;
      }

      const templateId = req.params.templateId;
      if (!templateId) {
        res.status(400).json({ error: 'templateId obrigatório' });
        return;
      }

      const actorUserId = resolveGovernanceActorFromRequest(logger, req, res, parsedBody.data.approvedBy ?? null);
      if (!actorUserId) return;

      try {
        const activated = await activatePromptTemplate({
          templateId,
          tenantId: parsedBody.data.tenantId,
          approvedBy: actorUserId,
        });
        res.status(200).json(activated);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'PROMPT_TEMPLATE_ACTIVATE_FAILED';
        if (message === 'PROMPT_TEMPLATE_NOT_FOUND') {
          res.status(404).json({ error: message });
          return;
        }
        if (
          message === 'PROMPT_TEMPLATE_EVAL_NOT_PASSED'
          || message === 'PROMPT_TEMPLATE_APPROVER_REQUIRED'
          || message === 'PROMPT_TEMPLATE_DUAL_CONTROL_REQUIRED'
          || message === 'PROMPT_TEMPLATE_APPROVAL_THRESHOLD_NOT_MET'
        ) {
          res.status(409).json({ error: message });
          return;
        }
        throw error;
      }
    })
  );

  app.get(
    '/api/llm/governance/tool-policies',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = toolPolicyListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
        return;
      }

      const rows = await listToolPolicies(parsed.data);
      res.status(200).json({ toolPolicies: rows });
    })
  );

  app.post(
    '/api/llm/governance/tool-policies',
    requireGovernanceMutationAuth(logger),
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = getToolPolicyCreateSchema().safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Body inválido', details: parsed.error.flatten() });
        return;
      }

      const actorUserId = resolveGovernanceActorFromRequest(logger, req, res, parsed.data.createdBy ?? null);
      if (!actorUserId) return;

      const created = await createToolPolicy({
        ...parsed.data,
        createdBy: actorUserId,
      });
      res.status(201).json(created);
    })
  );

  app.post(
    '/api/llm/governance/tool-policies/:policyId/approval',
    requireGovernanceMutationAuth(logger),
    asyncHandler(async (req: Request, res: Response) => {
      const parsedBody = getToolPolicyApprovalSchema().safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({ error: 'Body inválido', details: parsedBody.error.flatten() });
        return;
      }

      const policyId = req.params.policyId;
      if (!policyId) {
        res.status(400).json({ error: 'policyId obrigatório' });
        return;
      }

      const actorUserId = resolveGovernanceActorFromRequest(logger, req, res, parsedBody.data.approverUserId ?? null);
      if (!actorUserId) return;

      try {
        const summary = await recordToolPolicyApproval({
          policyId,
          ...parsedBody.data,
          approverUserId: actorUserId,
        });
        res.status(200).json(summary);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'TOOL_POLICY_APPROVAL_UPDATE_FAILED';
        if (message === 'TOOL_POLICY_NOT_FOUND') {
          res.status(404).json({ error: message });
          return;
        }
        throw error;
      }
    })
  );

  app.get(
    '/api/llm/governance/tool-policies/:policyId/approvals',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = toolPolicyApprovalListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
        return;
      }

      const policyId = req.params.policyId;
      if (!policyId) {
        res.status(400).json({ error: 'policyId obrigatório' });
        return;
      }

      try {
        const summary = await listToolPolicyApprovals({
          tenantId: parsed.data.tenantId,
          policyId,
        });
        res.status(200).json(summary);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'TOOL_POLICY_APPROVALS_LIST_FAILED';
        if (message === 'TOOL_POLICY_NOT_FOUND') {
          res.status(404).json({ error: message });
          return;
        }
        throw error;
      }
    })
  );

  app.post(
    '/api/llm/governance/tool-policies/:policyId/activate',
    requireGovernanceMutationAuth(logger),
    asyncHandler(async (req: Request, res: Response) => {
      const parsedBody = getToolPolicyActivateSchema().safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({ error: 'Body inválido', details: parsedBody.error.flatten() });
        return;
      }

      const policyId = req.params.policyId;
      if (!policyId) {
        res.status(400).json({ error: 'policyId obrigatório' });
        return;
      }

      const actorUserId = resolveGovernanceActorFromRequest(logger, req, res, parsedBody.data.approvedBy ?? null);
      if (!actorUserId) return;

      try {
        const activated = await activateToolPolicy({
          policyId,
          tenantId: parsedBody.data.tenantId,
          approvedBy: actorUserId,
        });
        res.status(200).json(activated);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'TOOL_POLICY_ACTIVATE_FAILED';
        if (message === 'TOOL_POLICY_NOT_FOUND') {
          res.status(404).json({ error: message });
          return;
        }
        if (
          message === 'TOOL_POLICY_APPROVER_REQUIRED'
          || message === 'TOOL_POLICY_DUAL_CONTROL_REQUIRED'
          || message === 'TOOL_POLICY_APPROVAL_THRESHOLD_NOT_MET'
        ) {
          res.status(409).json({ error: message });
          return;
        }
        throw error;
      }
    })
  );
}
