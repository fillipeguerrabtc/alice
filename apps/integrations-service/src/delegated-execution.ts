import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  appendImmutableAuditEvent,
  extractAuthContext,
  extractDelegatedExecutionToken,
  verifyDelegatedExecutionToken,
  type DelegatedExecutionTokenClaims,
} from '@alice/shared-utils';
import { getDatabase } from '@alice/database';
import type { ResourceType } from '@alice/shared-utils';

type LoggerLike = {
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
};

type DelegatedExecutionRequest = Request & {
  delegatedExecution?: DelegatedExecutionTokenClaims;
};

export function requireDelegatedAgentExecution(params: {
  actionKey: string;
  actionKeyResolver?: (req: Request) => string;
  logger: LoggerLike;
  payloadResolver: (req: Request) => unknown;
  namespaceIdResolver?: (req: Request) => string | null | undefined;
  agentIdResolver?: (req: Request) => string | null | undefined;
  resourceResolver?: (req: Request) => { resourceType?: ResourceType | null; resourceId?: string | null };
}): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const resolvedActionKey = params.actionKeyResolver?.(req) ?? params.actionKey;
    const auth = extractAuthContext(req);
    const delegatedToken = extractDelegatedExecutionToken(req.headers as Record<string, string | string[] | undefined>);
    const hasInternalActorHeaders = typeof req.headers['x-internal-user-id'] === 'string' && req.headers['x-internal-user-id'].trim().length > 0;

    if (!delegatedToken) {
      if (hasInternalActorHeaders) {
        res.status(401).json({
          error: 'Token delegado obrigatório para chamadas agentic internas',
          code: 'DELEGATED_TOKEN_REQUIRED',
        });
        return;
      }

      next();
      return;
    }

    if (!auth) {
      res.status(401).json({ error: 'Autenticação necessária', code: 'UNAUTHORIZED' });
      return;
    }

    const resource = params.resourceResolver?.(req) ?? {};
    const verification = await verifyDelegatedExecutionToken({
      delegatedToken,
      auth,
      actionKey: resolvedActionKey,
      payload: params.payloadResolver(req),
      namespaceId: params.namespaceIdResolver?.(req),
      agentId: params.agentIdResolver?.(req),
      resourceType: resource.resourceType ?? undefined,
      resourceId: resource.resourceId ?? undefined,
    });

    if (!verification.ok) {
      params.logger.warn(
        {
          actionKey: resolvedActionKey,
          code: verification.code,
          userId: auth.userId,
          tenantId: auth.tenantId,
        },
        'Token delegado rejeitado no integrations-service',
      );
      res.status(verification.status).json({ error: verification.message, code: verification.code });
      return;
    }

    (req as DelegatedExecutionRequest).delegatedExecution = verification.claims;

    try {
      await appendImmutableAuditEvent({
        db: getDatabase(),
        input: {
          tenantId: verification.claims.tenantId,
          actorUserId: verification.claims.actorUserId,
          sourceService: 'integrations-service',
          stream: 'agentic_delegated_actions',
          streamKey: verification.claims.conversationId ?? verification.claims.actionKey,
          eventType: 'downstream_consumed',
          resourceType: verification.action.module,
          resourceId: verification.claims.approvalRequestId ?? verification.claims.actionKey,
          requestId: req.headers['x-request-id'] as string | undefined,
          payload: {
            actionKey: verification.claims.actionKey,
            payloadHash: verification.claims.payloadHash,
            approvalRequestId: verification.claims.approvalRequestId,
            toolPolicyKey: verification.claims.toolPolicyKey,
            governanceHash: verification.claims.governanceHash,
          },
        },
      });
    } catch (error) {
      params.logger.error({ error }, 'Falha ao auditar consumo downstream do token delegado');
    }

    next();
  };
}
