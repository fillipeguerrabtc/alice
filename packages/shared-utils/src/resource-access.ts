import {
  and,
  eq,
  getDatabase,
  or,
  schema,
  type Database,
} from '@alice/database';
import { createLogger } from './logger.js';
import type { AuthContext } from './rbac/types.js';

const logger = createLogger('resource-access');

export type ResourceType =
  | 'conversation'
  | 'message'
  | 'document'
  | 'document_chunk'
  | 'namespace'
  | 'agent'
  | 'media_upload'
  | 'generated_image'
  | 'training_data'
  | 'tool_policy'
  | 'prompt_template'
  | 'llm_execution_audit';

export type ResourcePermission = 'read' | 'write' | 'delete' | 'manage' | 'approve' | 'train';

export interface ResourceAccessActor extends Partial<AuthContext> {
  tenantId: string;
}

export interface ResolvedResourceAccessActor extends ResourceAccessActor {
  roleCodes: string[];
  groupIds: string[];
  isSuperAdmin: boolean;
  breakGlassActive: boolean;
}

export interface ResourceAccessRecord {
  resourceType: ResourceType;
  resourceId: string;
  tenantId: string | null;
  ownerUserId: string | null;
  ownerGroupId: string | null;
  scopeType: string | null;
  visibility: string | null;
  sensitivityLabel: string | null;
  namespaceId: string | null;
  agentId: string | null;
}

export interface AuthorizeResourceAccessParams {
  actor: ResourceAccessActor;
  resourceType: ResourceType;
  resourceId: string;
  permission: ResourcePermission;
  tenantId: string;
  namespaceId?: string | null;
  agentId?: string | null;
  db?: Database;
}

export interface AuthorizeResourceAccessResult {
  allowed: boolean;
  reason:
    | 'owner'
    | 'grant'
    | 'tenant_visibility'
    | 'public_visibility'
    | 'break_glass'
    | 'forbidden'
    | 'not_found'
    | 'tenant_mismatch';
  actor: ResolvedResourceAccessActor;
  resource: ResourceAccessRecord | null;
}

export class ResourceAccessError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 403,
    public readonly code: string = 'RESOURCE_ACCESS_DENIED'
  ) {
    super(message);
    this.name = 'ResourceAccessError';
  }
}

function normalizeRoleCodes(actor: ResourceAccessActor): string[] {
  const explicit = (actor.roleCodes ?? []).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (explicit.length > 0) {
    return Array.from(new Set(explicit));
  }
  return Array.from(
    new Set(
      [
        actor.role,
        ...(actor.customRoleId ? [`custom:${actor.customRoleId}`] : []),
      ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    )
  );
}

async function resolveActorAccessContext(
  actor: ResourceAccessActor,
  db: Database
): Promise<ResolvedResourceAccessActor> {
  const roleCodes = normalizeRoleCodes(actor);
  const groupRows = actor.userId
    ? await db.query.userGroupMembers.findMany({
        where: and(
          eq(schema.userGroupMembers.tenantId, actor.tenantId),
          eq(schema.userGroupMembers.userId, actor.userId),
        ),
        columns: { groupId: true },
      })
    : [];

  return {
    ...actor,
    roleCodes,
    groupIds: actor.groupIds ?? groupRows.map((row) => row.groupId),
    isSuperAdmin: actor.isSuperAdmin === true || actor.role === 'super_admin',
    breakGlassActive: actor.breakGlassActive === true,
  };
}

async function fetchResourceRecord(
  db: Database,
  resourceType: ResourceType,
  resourceId: string
): Promise<ResourceAccessRecord | null> {
  switch (resourceType) {
    case 'conversation': {
      const row = await db.query.conversations.findFirst({
        where: eq(schema.conversations.id, resourceId),
      });
      if (!row) return null;
      return {
        resourceType,
        resourceId: row.id,
        tenantId: row.tenantId ?? null,
        ownerUserId: row.ownerUserId ?? row.userId ?? null,
        ownerGroupId: row.ownerGroupId ?? null,
        scopeType: row.scopeType ?? 'user',
        visibility: row.visibility ?? 'private',
        sensitivityLabel: row.sensitivityLabel ?? 'confidential',
        namespaceId: row.namespaceId ?? null,
        agentId: row.agentId ?? null,
      };
    }
    case 'message': {
      const row = await db.query.messages.findFirst({
        where: eq(schema.messages.id, resourceId),
        with: {
          conversation: {
            columns: {
              tenantId: true,
              ownerUserId: true,
              ownerGroupId: true,
              namespaceId: true,
              agentId: true,
            },
          },
        },
      });
      if (!row) return null;
      return {
        resourceType,
        resourceId: row.id,
        tenantId: row.tenantId ?? row.conversation?.tenantId ?? null,
        ownerUserId: row.ownerUserId ?? row.userId ?? row.conversation?.ownerUserId ?? null,
        ownerGroupId: row.ownerGroupId ?? row.conversation?.ownerGroupId ?? null,
        scopeType: row.scopeType ?? 'user',
        visibility: row.visibility ?? 'private',
        sensitivityLabel: row.sensitivityLabel ?? 'confidential',
        namespaceId: row.conversation?.namespaceId ?? null,
        agentId: row.agentId ?? row.conversation?.agentId ?? null,
      };
    }
    case 'document': {
      const row = await db.query.documents.findFirst({
        where: eq(schema.documents.id, resourceId),
      });
      if (!row) return null;
      return {
        resourceType,
        resourceId: row.id,
        tenantId: row.tenantId ?? null,
        ownerUserId: row.ownerUserId ?? null,
        ownerGroupId: row.ownerGroupId ?? null,
        scopeType: row.scopeType ?? 'tenant',
        visibility: row.visibility ?? 'private',
        sensitivityLabel: row.sensitivityLabel ?? 'confidential',
        namespaceId: row.namespaceId ?? null,
        agentId: null,
      };
    }
    case 'document_chunk': {
      const row = await db.query.documentChunks.findFirst({
        where: eq(schema.documentChunks.id, resourceId),
        with: {
          document: {
            columns: {
              namespaceId: true,
              tenantId: true,
              ownerUserId: true,
              ownerGroupId: true,
            },
          },
        },
      });
      if (!row) return null;
      return {
        resourceType,
        resourceId: row.id,
        tenantId: row.tenantId ?? row.document?.tenantId ?? null,
        ownerUserId: row.ownerUserId ?? row.document?.ownerUserId ?? null,
        ownerGroupId: row.ownerGroupId ?? row.document?.ownerGroupId ?? null,
        scopeType: row.scopeType ?? 'tenant',
        visibility: row.visibility ?? 'private',
        sensitivityLabel: row.sensitivityLabel ?? 'confidential',
        namespaceId: row.document?.namespaceId ?? null,
        agentId: null,
      };
    }
    case 'namespace': {
      const row = await db.query.namespaces.findFirst({
        where: eq(schema.namespaces.id, resourceId),
      });
      if (!row) return null;
      return {
        resourceType,
        resourceId: row.id,
        tenantId: row.tenantId ?? null,
        ownerUserId: row.ownerUserId ?? null,
        ownerGroupId: row.ownerGroupId ?? null,
        scopeType: row.scopeType ?? 'tenant',
        visibility: row.visibility ?? 'tenant',
        sensitivityLabel: row.sensitivityLabel ?? 'standard',
        namespaceId: row.id,
        agentId: null,
      };
    }
    case 'agent': {
      const row = await db.query.agents.findFirst({
        where: eq(schema.agents.id, resourceId),
      });
      if (!row) return null;
      return {
        resourceType,
        resourceId: row.id,
        tenantId: row.tenantId ?? null,
        ownerUserId: row.ownerUserId ?? null,
        ownerGroupId: row.ownerGroupId ?? null,
        scopeType: row.scopeType ?? 'tenant',
        visibility: row.visibility ?? 'tenant',
        sensitivityLabel: row.sensitivityLabel ?? 'standard',
        namespaceId: row.namespaceId ?? null,
        agentId: row.id,
      };
    }
    case 'media_upload': {
      const row = await db.query.mediaUploads.findFirst({
        where: eq(schema.mediaUploads.id, resourceId),
      });
      if (!row) return null;
      return {
        resourceType,
        resourceId: row.id,
        tenantId: row.tenantId ?? null,
        ownerUserId: row.ownerUserId ?? row.userId ?? null,
        ownerGroupId: row.ownerGroupId ?? null,
        scopeType: row.scopeType ?? 'user',
        visibility: row.visibility ?? 'private',
        sensitivityLabel: row.sensitivityLabel ?? 'confidential',
        namespaceId: row.namespaceId ?? null,
        agentId: null,
      };
    }
    case 'generated_image': {
      const row = await db.query.generatedImages.findFirst({
        where: eq(schema.generatedImages.id, resourceId),
      });
      if (!row) return null;
      return {
        resourceType,
        resourceId: row.id,
        tenantId: row.tenantId ?? null,
        ownerUserId: row.ownerUserId ?? row.createdBy ?? null,
        ownerGroupId: row.ownerGroupId ?? null,
        scopeType: row.scopeType ?? 'user',
        visibility: row.visibility ?? 'private',
        sensitivityLabel: row.sensitivityLabel ?? 'confidential',
        namespaceId: null,
        agentId: null,
      };
    }
    case 'training_data': {
      const row = await db.query.trainingData.findFirst({
        where: eq(schema.trainingData.id, resourceId),
      });
      if (!row) return null;
      return {
        resourceType,
        resourceId: row.id,
        tenantId: row.tenantId ?? null,
        ownerUserId: row.ownerUserId ?? row.createdBy ?? null,
        ownerGroupId: row.ownerGroupId ?? null,
        scopeType: row.scopeType ?? 'user',
        visibility: row.visibility ?? 'private',
        sensitivityLabel: row.sensitivityLabel ?? 'confidential',
        namespaceId: row.namespaceId ?? null,
        agentId: row.agentId ?? null,
      };
    }
    case 'tool_policy': {
      const row = await db.query.toolPolicies.findFirst({
        where: eq(schema.toolPolicies.id, resourceId),
      });
      if (!row) return null;
      return {
        resourceType,
        resourceId: row.id,
        tenantId: row.tenantId ?? null,
        ownerUserId: row.ownerUserId ?? row.createdBy ?? null,
        ownerGroupId: row.ownerGroupId ?? null,
        scopeType: row.scopeType ?? 'tenant',
        visibility: row.visibility ?? 'private',
        sensitivityLabel: row.sensitivityLabel ?? 'restricted',
        namespaceId: row.namespaceId ?? null,
        agentId: row.agentId ?? null,
      };
    }
    case 'prompt_template': {
      const row = await db.query.promptTemplates.findFirst({
        where: eq(schema.promptTemplates.id, resourceId),
      });
      if (!row) return null;
      return {
        resourceType,
        resourceId: row.id,
        tenantId: row.tenantId ?? null,
        ownerUserId: row.ownerUserId ?? row.createdBy ?? null,
        ownerGroupId: row.ownerGroupId ?? null,
        scopeType: row.scopeType ?? 'tenant',
        visibility: row.visibility ?? 'private',
        sensitivityLabel: row.sensitivityLabel ?? 'restricted',
        namespaceId: row.namespaceId ?? null,
        agentId: row.agentId ?? null,
      };
    }
    case 'llm_execution_audit': {
      const row = await db.query.llmExecutionAudit.findFirst({
        where: eq(schema.llmExecutionAudit.id, resourceId),
      });
      if (!row) return null;
      return {
        resourceType,
        resourceId: row.id,
        tenantId: row.tenantId ?? null,
        ownerUserId: row.ownerUserId ?? row.userId ?? null,
        ownerGroupId: row.ownerGroupId ?? null,
        scopeType: row.scopeType ?? 'user',
        visibility: row.visibility ?? 'private',
        sensitivityLabel: row.sensitivityLabel ?? 'restricted',
        namespaceId: row.namespaceId ?? null,
        agentId: row.agentId ?? null,
      };
    }
  }
}

function grantAllowsPermission(grantPermissions: string[] | null | undefined, requestedPermission: ResourcePermission): boolean {
  if (!grantPermissions || grantPermissions.length === 0) {
    return false;
  }
  const normalized = new Set(grantPermissions.map((permission) => permission.trim().toLowerCase()));
  if (normalized.has('*') || normalized.has('manage')) {
    return true;
  }
  if (normalized.has(requestedPermission)) {
    return true;
  }
  if (requestedPermission === 'read' && (normalized.has('write') || normalized.has('delete'))) {
    return true;
  }
  return false;
}

async function hasExplicitGrant(params: {
  db: Database;
  actor: ResolvedResourceAccessActor;
  resourceType: ResourceType;
  resourceId: string;
  permission: ResourcePermission;
}): Promise<boolean> {
  const userSubjectIds = params.actor.userId ? [params.actor.userId] : [];
  const subjectIds = [
    { type: 'user' as const, ids: userSubjectIds },
    { type: 'tenant' as const, ids: [params.actor.tenantId] },
    { type: 'role' as const, ids: params.actor.roleCodes },
    { type: 'group' as const, ids: params.actor.groupIds },
  ].flatMap((entry) =>
    entry.ids
      .filter((subjectId): subjectId is string => typeof subjectId === 'string' && subjectId.trim().length > 0)
      .map((subjectId) => ({ subjectType: entry.type, subjectId }))
  );

  if (subjectIds.length === 0) {
    return false;
  }

  const grants = await params.db.query.resourceAccessGrants.findMany({
    where: and(
      eq(schema.resourceAccessGrants.tenantId, params.actor.tenantId),
      eq(schema.resourceAccessGrants.resourceType, params.resourceType),
      eq(schema.resourceAccessGrants.resourceId, params.resourceId),
      or(
        ...subjectIds.map((entry) => and(
          eq(schema.resourceAccessGrants.subjectType, entry.subjectType),
          eq(schema.resourceAccessGrants.subjectId, entry.subjectId),
        ))
      ),
    ),
  });

  const now = Date.now();
  return grants.some((grant) => {
    if (grant.revokedAt) return false;
    if (grant.expiresAt && grant.expiresAt.getTime() <= now) return false;
    return grantAllowsPermission(grant.permissions, params.permission);
  });
}

function visibilityAllowsAccess(resource: ResourceAccessRecord, permission: ResourcePermission): boolean {
  if (permission !== 'read') {
    return false;
  }
  return resource.visibility === 'public' || resource.visibility === 'tenant';
}

export async function authorizeResourceAccess(
  params: AuthorizeResourceAccessParams
): Promise<AuthorizeResourceAccessResult> {
  const db = params.db ?? getDatabase();
  const actor = await resolveActorAccessContext(params.actor, db);

  if (!actor.tenantId || actor.tenantId !== params.tenantId) {
    return {
      allowed: false,
      reason: 'tenant_mismatch',
      actor,
      resource: null,
    };
  }

  const resource = await fetchResourceRecord(db, params.resourceType, params.resourceId);
  if (!resource) {
    return {
      allowed: false,
      reason: 'not_found',
      actor,
      resource: null,
    };
  }

  if (resource.tenantId && resource.tenantId !== actor.tenantId && !actor.isSuperAdmin) {
    return {
      allowed: false,
      reason: 'tenant_mismatch',
      actor,
      resource,
    };
  }

  if (params.namespaceId && resource.namespaceId && params.namespaceId !== resource.namespaceId) {
    return {
      allowed: false,
      reason: 'forbidden',
      actor,
      resource,
    };
  }

  if (params.agentId && resource.agentId && params.agentId !== resource.agentId) {
    return {
      allowed: false,
      reason: 'forbidden',
      actor,
      resource,
    };
  }

  if (actor.isSuperAdmin && actor.breakGlassActive) {
    return {
      allowed: true,
      reason: 'break_glass',
      actor,
      resource,
    };
  }

  if (resource.ownerUserId && resource.ownerUserId === actor.userId) {
    return {
      allowed: true,
      reason: 'owner',
      actor,
      resource,
    };
  }

  if (resource.ownerGroupId && actor.groupIds.includes(resource.ownerGroupId)) {
    return {
      allowed: true,
      reason: 'owner',
      actor,
      resource,
    };
  }

  if (visibilityAllowsAccess(resource, params.permission)) {
    return {
      allowed: true,
      reason: resource.visibility === 'public' ? 'public_visibility' : 'tenant_visibility',
      actor,
      resource,
    };
  }

  const hasGrant = await hasExplicitGrant({
    db,
    actor,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    permission: params.permission,
  });

  if (hasGrant) {
    return {
      allowed: true,
      reason: 'grant',
      actor,
      resource,
    };
  }

  return {
    allowed: false,
    reason: 'forbidden',
    actor,
    resource,
  };
}

export async function assertAuthorizedResourceAccess(
  params: AuthorizeResourceAccessParams
): Promise<AuthorizeResourceAccessResult> {
  const result = await authorizeResourceAccess(params);
  if (!result.allowed) {
    logger.info(
      {
        actorUserId: result.actor.userId,
        tenantId: result.actor.tenantId,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        permission: params.permission,
        reason: result.reason,
      },
      'Acesso a recurso negado'
    );

    if (result.reason === 'not_found') {
      throw new ResourceAccessError('Recurso não encontrado', 404, 'RESOURCE_NOT_FOUND');
    }
    if (result.reason === 'tenant_mismatch') {
      throw new ResourceAccessError('Recurso não pertence ao tenant autenticado', 403, 'RESOURCE_TENANT_MISMATCH');
    }
    throw new ResourceAccessError('Acesso ao recurso negado', 403, 'RESOURCE_ACCESS_DENIED');
  }
  return result;
}

export async function filterAccessibleResources<T extends { id: string }>(params: {
  actor: ResourceAccessActor;
  tenantId: string;
  resourceType: ResourceType;
  permission: ResourcePermission;
  resources: T[];
  db?: Database;
}): Promise<T[]> {
  const db = params.db ?? getDatabase();
  const authorizedIds = await Promise.all(
    params.resources.map(async (resource) => {
      const result = await authorizeResourceAccess({
        actor: params.actor,
        resourceType: params.resourceType,
        resourceId: resource.id,
        permission: params.permission,
        tenantId: params.tenantId,
        db,
      });
      return result.allowed ? resource.id : null;
    })
  );

  const allowedSet = new Set(authorizedIds.filter((value): value is string => Boolean(value)));
  return params.resources.filter((resource) => allowedSet.has(resource.id));
}
