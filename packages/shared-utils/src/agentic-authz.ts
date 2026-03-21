import crypto from 'node:crypto';
import {
  and,
  desc,
  eq,
  getDatabase,
  inArray,
  or,
  schema,
  sql,
} from '@alice/database';
import { createLogger } from './logger.js';
import {
  getAgentActionCatalogEntry,
  listAgentActionCatalog,
  matchesAgentActionSelector,
  type AgentActionCatalogEntry,
} from './agentic-capability-catalog.js';
import { appendImmutableAuditEvent } from './immutable-audit-ledger.js';
import { authorizeResourceAccess, type ResourcePermission, type ResourceType } from './resource-access.js';
import { generateInternalAuthHeaders } from './rbac/middleware.js';
import { PERMISSION_MAP } from './rbac/permissions.js';
import { ROLE_HIERARCHY, type AuthContext, type Role } from './rbac/types.js';
import { getRedisClient } from './redis-cache-adapter.js';

const logger = createLogger('agentic-authz');
const DELEGATED_TOKEN_TTL_SECONDS = Number(process.env.DELEGATED_EXECUTION_TOKEN_TTL_SECONDS ?? '180');
const DELEGATED_TOKEN_CONSUME_PREFIX = 'alice:delegated-execution:consumed';
const DELEGATED_TOKEN_SECRET = process.env.INTERNAL_API_SECRET ?? '';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GovernanceHints = {
  promptTemplateId?: string;
  promptVersion?: number;
  toolPolicyKey?: string;
  toolPolicyVersion?: number;
};

type ToolPolicyCandidate = {
  id: string;
  policyKey: string;
  namespaceId: string | null;
  agentId: string | null;
  version: number;
  allowTools: string[];
  denyTools: string[];
  atualizadoEm: Date | null;
};

export type EffectivePermissionEnvelope = {
  userId: string;
  tenantId: string;
  baseRole: Role;
  baseRoles: Role[];
  customRoleId: string | null;
  customRoleIds: string[];
  permissions: string[];
  permissionsVersion: string;
  grantsVersion: string;
  permissionSnapshotHash: string;
};

export type ResolvedGovernanceEnvelope = {
  promptTemplateId: string | null;
  promptVersion: number | null;
  toolPolicyKey: string | null;
  toolPolicyVersion: number | null;
  allowSelectors: string[];
  denySelectors: string[];
  governanceHash: string;
};

export type AuthorizedActionDecision = {
  allowed: boolean;
  reason:
    | 'catalog_not_found'
    | 'disabled'
    | 'permission_denied'
    | 'resource_denied'
    | 'governance_denied'
    | 'namespace_denied'
    | 'service_account_denied'
    | 'service_account_mask_forbidden'
    | 'ok';
  action: AgentActionCatalogEntry | null;
  payloadHash: string;
  authzDecisionId: string | null;
  envelope: EffectivePermissionEnvelope;
  governance: ResolvedGovernanceEnvelope;
  resourceDecision?: Awaited<ReturnType<typeof authorizeResourceAccess>>;
};

export type DelegatedExecutionTokenClaims = {
  tokenId: string;
  actorUserId: string;
  tenantId: string;
  baseRole: Role;
  customRoleId: string | null;
  permissionsVersion: string;
  grantsVersion: string;
  permissionSnapshotHash: string;
  conversationId: string | null;
  namespaceId: string | null;
  agentId: string | null;
  actionKey: string;
  capabilityId: string;
  requiredPermission: string;
  resourceType: string | null;
  resourceId: string | null;
  riskLevel: AgentActionCatalogEntry['riskLevel'];
  requiresApproval: boolean;
  requiresStepUp: boolean;
  requiresDualControl: boolean;
  toolPolicyKey: string | null;
  toolPolicyVersion: number | null;
  promptTemplateId: string | null;
  promptVersion: number | null;
  governanceHash: string;
  payloadHash: string;
  approvalRequestId: string | null;
  sessionId: string | null;
  stepUpContext: Record<string, unknown> | null;
  issuedAt: string;
  expiresAt: string;
  singleUse: boolean;
};

export type DelegatedExecutionVerificationResult =
  | {
      ok: true;
      claims: DelegatedExecutionTokenClaims;
      action: AgentActionCatalogEntry;
      envelope: EffectivePermissionEnvelope;
      governance: ResolvedGovernanceEnvelope;
    }
  | {
      ok: false;
      code:
        | 'DELEGATED_TOKEN_REQUIRED'
        | 'DELEGATED_TOKEN_INVALID'
        | 'DELEGATED_TOKEN_EXPIRED'
        | 'DELEGATED_TOKEN_REUSED'
        | 'DELEGATED_TOKEN_PAYLOAD_MISMATCH'
        | 'DELEGATED_TOKEN_ACTION_MISMATCH'
        | 'DELEGATED_TOKEN_ACTOR_MISMATCH'
        | 'DELEGATED_TOKEN_REVOKED'
        | 'DELEGATED_TOKEN_GOVERNANCE_MISMATCH'
        | 'DELEGATED_TOKEN_APPROVAL_INVALID'
        | 'DELEGATED_TOKEN_RESOURCE_DENIED'
        | 'DELEGATED_TOKEN_REDIS_UNAVAILABLE';
      status: 400 | 401 | 403 | 409 | 503;
      message: string;
    };

export type ServiceAccountScope = {
  serviceAccountId: string;
  allowedActionKeys: string[];
  namespaceScope?: string[] | null;
  agentScope?: string[] | null;
  enabled: boolean;
};

export async function resolveServiceAccountScope(params: {
  tenantId: string;
  serviceAccountId: string;
}): Promise<ServiceAccountScope | null> {
  const db = getDatabase();
  const row = await db.query.serviceAccounts.findFirst({
    where: and(
      eq(schema.serviceAccounts.id, params.serviceAccountId),
      eq(schema.serviceAccounts.tenantId, params.tenantId),
    ),
    columns: {
      id: true,
      allowedActionKeys: true,
      namespaceScope: true,
      agentScope: true,
      enabled: true,
    },
  });

  if (!row) {
    return null;
  }

  return {
    serviceAccountId: row.id,
    allowedActionKeys: sanitizeSelectors(Array.isArray(row.allowedActionKeys) ? row.allowedActionKeys : []),
    namespaceScope: sanitizeSelectors(Array.isArray(row.namespaceScope) ? row.namespaceScope : []),
    agentScope: sanitizeSelectors(Array.isArray(row.agentScope) ? row.agentScope : []),
    enabled: row.enabled,
  };
}

function canonicalizeValue(input: unknown): string {
  if (input === null || typeof input !== 'object') {
    return JSON.stringify(input);
  }
  if (Array.isArray(input)) {
    return `[${input.map((item) => canonicalizeValue(item)).join(',')}]`;
  }
  const entries = Object.entries(input as Record<string, unknown>)
    .filter(([, value]) => typeof value !== 'undefined')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${JSON.stringify(key)}:${canonicalizeValue(value)}`);
  return `{${entries.join(',')}}`;
}

function createStableHash(input: unknown): string {
  return crypto.createHash('sha256').update(canonicalizeValue(input)).digest('hex');
}

export function createAgentPayloadHash(payload: unknown): string {
  return createStableHash(payload ?? {});
}

function normalizeToolSelectors(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const unique = new Set<string>();
  const selectors: string[] = [];
  for (const rawValue of input) {
    if (typeof rawValue !== 'string') {
      continue;
    }
    const value = rawValue.trim();
    if (!value || unique.has(value)) {
      continue;
    }
    unique.add(value);
    selectors.push(value);
  }
  return selectors;
}

function parseGovernanceHints(config: unknown): GovernanceHints {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {};
  }

  const llmGovernance = (config as { llmGovernance?: Record<string, unknown> }).llmGovernance;
  if (!llmGovernance || typeof llmGovernance !== 'object' || Array.isArray(llmGovernance)) {
    return {};
  }

  const promptVersion = typeof llmGovernance.promptVersion === 'number' && Number.isInteger(llmGovernance.promptVersion)
    ? llmGovernance.promptVersion
    : undefined;
  const toolPolicyVersion = typeof llmGovernance.toolPolicyVersion === 'number' && Number.isInteger(llmGovernance.toolPolicyVersion)
    ? llmGovernance.toolPolicyVersion
    : undefined;

  return {
    promptTemplateId: typeof llmGovernance.promptTemplateId === 'string' ? llmGovernance.promptTemplateId : undefined,
    promptVersion,
    toolPolicyKey: typeof llmGovernance.toolPolicyKey === 'string' ? llmGovernance.toolPolicyKey : undefined,
    toolPolicyVersion,
  };
}

async function resolveNamespaceProfileGovernanceDefaults(params: {
  tenantId: string;
  namespaceId?: string | null;
}): Promise<GovernanceHints> {
  if (!params.namespaceId) {
    return {};
  }

  const db = getDatabase();
  const profile = await db.query.namespaceProfiles.findFirst({
    where: and(
      eq(schema.namespaceProfiles.tenantId, params.tenantId),
      eq(schema.namespaceProfiles.namespaceId, params.namespaceId),
      eq(schema.namespaceProfiles.isActive, true),
    ),
    columns: {
      config: true,
    },
  });

  return parseGovernanceHints(profile?.config);
}

function sanitizeSelectors(input: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of input ?? []) {
    const value = raw.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    cleaned.push(value);
  }
  return cleaned;
}

function selectBestToolPolicyMatch(params: {
  candidates: ToolPolicyCandidate[];
  namespaceId?: string | null;
  agentId?: string | null;
}): ToolPolicyCandidate | null {
  const scored = params.candidates
    .map((candidate) => {
      if (candidate.namespaceId && candidate.namespaceId !== (params.namespaceId ?? null)) {
        return null;
      }
      if (candidate.agentId && candidate.agentId !== (params.agentId ?? null)) {
        return null;
      }
      const specificity = (candidate.namespaceId ? 1 : 0) + (candidate.agentId ? 2 : 0);
      return { candidate, specificity };
    })
    .filter((entry): entry is { candidate: ToolPolicyCandidate; specificity: number } => Boolean(entry))
    .sort((left, right) => {
      if (right.specificity !== left.specificity) {
        return right.specificity - left.specificity;
      }
      if (right.candidate.version !== left.candidate.version) {
        return right.candidate.version - left.candidate.version;
      }
      const rightTime = right.candidate.atualizadoEm?.getTime() ?? 0;
      const leftTime = left.candidate.atualizadoEm?.getTime() ?? 0;
      return rightTime - leftTime;
    });

  return scored[0]?.candidate ?? null;
}

function resolveHighestRole(baseRoles: Role[], fallbackRole: Role): Role {
  if (baseRoles.length === 0) {
    return fallbackRole;
  }
  return baseRoles.reduce((highest, role) => (
    ROLE_HIERARCHY[role] < ROLE_HIERARCHY[highest] ? role : highest
  ));
}

async function resolveUserRoleAssignments(params: {
  userId: string;
  tenantId?: string | null;
}): Promise<{ baseRoles: Role[]; customRoleIds: string[] }> {
  if (!UUID_REGEX.test(params.userId)) {
    return { baseRoles: [], customRoleIds: [] };
  }

  const db = getDatabase();

  const linkedRoles = await db.query.userRoles.findMany({
    where: eq(schema.userRoles.userId, params.userId),
    columns: { role: true },
  });
  let baseRoles = linkedRoles.map((item) => item.role as Role).filter(Boolean);

  if (baseRoles.length === 0) {
    const fallbackUser = await db.query.users.findFirst({
      where: eq(schema.users.id, params.userId),
      columns: { role: true },
    });
    if (fallbackUser?.role) {
      baseRoles = [fallbackUser.role as Role];
    }
  }

  const customRoleLinks = await db.query.userCustomRoles.findMany({
    where: eq(schema.userCustomRoles.userId, params.userId),
    with: {
      customRole: {
        columns: { id: true, ativo: true, tenantId: true },
      },
    },
  });

  let customRoleIds = customRoleLinks
    .filter((link) => link.customRole?.ativo)
    .filter((link) => !params.tenantId || link.customRole?.tenantId === params.tenantId)
    .map((link) => link.customRoleId);

  if (customRoleIds.length === 0) {
    const fallbackUser = await db.query.users.findFirst({
      where: eq(schema.users.id, params.userId),
      columns: { customRoleId: true },
    });
    const fallbackCustomRoleId = fallbackUser?.customRoleId ?? undefined;
    if (fallbackCustomRoleId) {
      const activeRole = await db.query.customRoles.findFirst({
        where: and(
          eq(schema.customRoles.id, fallbackCustomRoleId),
          eq(schema.customRoles.ativo, true),
          params.tenantId ? eq(schema.customRoles.tenantId, params.tenantId) : sql`1=1`,
        ),
        columns: { id: true },
      });
      if (activeRole) {
        customRoleIds = [fallbackCustomRoleId];
      }
    }
  }

  return { baseRoles, customRoleIds };
}

export async function resolveEffectivePermissionEnvelope(auth: AuthContext): Promise<EffectivePermissionEnvelope> {
  const db = getDatabase();
  const resolvedTenantId = auth.tenantId?.trim();
  if (!resolvedTenantId) {
    throw new Error('TENANT_ID_REQUIRED_FOR_AGENTIC_AUTHZ');
  }

  const { baseRoles, customRoleIds } = await resolveUserRoleAssignments({
    userId: auth.userId,
    tenantId: resolvedTenantId,
  });
  const baseRole = resolveHighestRole(baseRoles, auth.role);
  const isAdminRole = baseRoles.some((role) => role === 'admin' || role === 'super_admin');

  const rolePermissions = isAdminRole
    ? await db.query.permissions.findMany({ columns: { codigo: true } })
    : baseRoles.length > 0
      ? await db.query.rolePermissions.findMany({
          where: inArray(schema.rolePermissions.role, baseRoles),
          with: { permission: true },
        })
      : [];

  const customRolePermissions = customRoleIds.length > 0
    ? await db.query.customRolePermissions.findMany({
        where: inArray(schema.customRolePermissions.customRoleId, customRoleIds),
        with: { permission: true },
      })
    : [];

  const dbPermissions = rolePermissions
    .map((row) => ('codigo' in row ? row.codigo : (row as { permission?: { codigo?: string | null } }).permission?.codigo))
    .filter((code): code is string => Boolean(code));
  const explicitCustomPermissions = customRolePermissions
    .map((row) => (row as { permission?: { codigo?: string | null } }).permission?.codigo)
    .filter((code): code is string => Boolean(code));
  const basePermissions = Object.entries(PERMISSION_MAP)
    .filter(([, roles]) => roles.some((role) => baseRoles.includes(role as Role)))
    .map(([permission]) => permission);

  const permissions = Array.from(new Set([...dbPermissions, ...explicitCustomPermissions, ...basePermissions])).sort();
  if (isAdminRole && !permissions.includes('admin:alice_core:write')) {
    permissions.push('admin:alice_core:write');
    permissions.sort();
  }

  const groups = await db.query.userGroupMembers.findMany({
    where: and(
      eq(schema.userGroupMembers.tenantId, resolvedTenantId),
      eq(schema.userGroupMembers.userId, auth.userId),
    ),
    columns: {
      groupId: true,
      criadoEm: true,
    },
  });

  const roleCodes = Array.from(new Set([
    ...baseRoles,
    ...customRoleIds.map((customRoleId) => `custom:${customRoleId}`),
  ])).sort();

  const subjectFilters = [
    and(eq(schema.resourceAccessGrants.subjectType, 'user'), eq(schema.resourceAccessGrants.subjectId, auth.userId)),
    and(eq(schema.resourceAccessGrants.subjectType, 'tenant'), eq(schema.resourceAccessGrants.subjectId, resolvedTenantId)),
    ...roleCodes.map((roleCode) => and(
      eq(schema.resourceAccessGrants.subjectType, 'role'),
      eq(schema.resourceAccessGrants.subjectId, roleCode),
    )),
    ...groups.map((group) => and(
      eq(schema.resourceAccessGrants.subjectType, 'group'),
      eq(schema.resourceAccessGrants.subjectId, group.groupId),
    )),
  ];

  const grantRows = subjectFilters.length > 0
    ? await db.query.resourceAccessGrants.findMany({
        where: and(
          eq(schema.resourceAccessGrants.tenantId, resolvedTenantId),
          or(...subjectFilters),
        ),
        columns: {
          id: true,
          resourceType: true,
          resourceId: true,
          subjectType: true,
          subjectId: true,
          permissions: true,
          grantedAt: true,
          expiresAt: true,
          revokedAt: true,
        },
      })
    : [];

  const permissionsVersion = createStableHash({
    baseRole,
    baseRoles: [...baseRoles].sort(),
    customRoleIds: [...customRoleIds].sort(),
    permissions,
  });
  const grantsVersion = createStableHash({
    groups: groups.map((group) => ({
      groupId: group.groupId,
      createdAt: group.criadoEm?.toISOString?.() ?? null,
    })),
    grants: grantRows.map((grant) => ({
      id: grant.id,
      resourceType: grant.resourceType,
      resourceId: grant.resourceId,
      subjectType: grant.subjectType,
      subjectId: grant.subjectId,
      permissions: grant.permissions,
      grantedAt: grant.grantedAt?.toISOString?.() ?? null,
      expiresAt: grant.expiresAt?.toISOString?.() ?? null,
      revokedAt: grant.revokedAt?.toISOString?.() ?? null,
    })),
  });
  const permissionSnapshotHash = createStableHash({
    permissionsVersion,
    grantsVersion,
    permissions,
  });

  return {
    userId: auth.userId,
    tenantId: resolvedTenantId,
    baseRole,
    baseRoles: [...baseRoles].sort((left, right) => left.localeCompare(right)),
    customRoleId: customRoleIds[0] ?? null,
    customRoleIds: [...customRoleIds].sort(),
    permissions,
    permissionsVersion,
    grantsVersion,
    permissionSnapshotHash,
  };
}

export function createDatabasePermissionResolver(): (auth: AuthContext) => Promise<string[]> {
  return async (auth: AuthContext) => {
    const envelope = await resolveEffectivePermissionEnvelope(auth);
    return envelope.permissions;
  };
}

export async function resolveGovernanceEnvelope(params: {
  tenantId: string;
  namespaceId?: string | null;
  agentId?: string | null;
}): Promise<ResolvedGovernanceEnvelope> {
  const db = getDatabase();
  const defaults = await resolveNamespaceProfileGovernanceDefaults({
    tenantId: params.tenantId,
    namespaceId: params.namespaceId,
  });

  let promptTemplateId: string | null = null;
  let promptVersion: number | null = null;
  let toolPolicyKey: string | null = defaults.toolPolicyKey ?? null;
  let toolPolicyVersion: number | null = null;
  const allowSelectors: string[] = [];
  const denySelectors: string[] = [];

  if (defaults.promptTemplateId) {
    const template = await db.query.promptTemplates.findFirst({
      where: and(
        eq(schema.promptTemplates.id, defaults.promptTemplateId),
        eq(schema.promptTemplates.tenantId, params.tenantId),
        eq(schema.promptTemplates.status, 'active'),
      ),
      columns: {
        id: true,
        version: true,
        namespaceId: true,
        agentId: true,
        metadata: true,
      },
    });

    if (
      template
      && (!template.namespaceId || template.namespaceId === (params.namespaceId ?? null))
      && (!template.agentId || template.agentId === (params.agentId ?? null))
    ) {
      promptTemplateId = template.id;
      promptVersion = template.version;
      const metadata = (template.metadata ?? {}) as Record<string, unknown>;
      allowSelectors.push(...normalizeToolSelectors(metadata.allowedActionKeys));
      denySelectors.push(...normalizeToolSelectors(metadata.deniedActionKeys));
      if (!toolPolicyKey && typeof metadata.toolPolicyKey === 'string') {
        toolPolicyKey = metadata.toolPolicyKey;
      }
    }
  }

  if (toolPolicyKey) {
    const candidates = await db.query.toolPolicies.findMany({
      where: and(
        eq(schema.toolPolicies.tenantId, params.tenantId),
        eq(schema.toolPolicies.policyKey, toolPolicyKey),
        eq(schema.toolPolicies.status, 'active'),
      ),
      orderBy: [desc(schema.toolPolicies.version), desc(schema.toolPolicies.atualizadoEm)],
      columns: {
        id: true,
        policyKey: true,
        namespaceId: true,
        agentId: true,
        version: true,
        allowTools: true,
        denyTools: true,
        atualizadoEm: true,
      },
    });

    const selected = selectBestToolPolicyMatch({
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        policyKey: candidate.policyKey,
        namespaceId: candidate.namespaceId,
        agentId: candidate.agentId,
        version: candidate.version,
        allowTools: sanitizeSelectors(Array.isArray(candidate.allowTools) ? candidate.allowTools : []),
        denyTools: sanitizeSelectors(Array.isArray(candidate.denyTools) ? candidate.denyTools : []),
        atualizadoEm: candidate.atualizadoEm,
      })),
      namespaceId: params.namespaceId,
      agentId: params.agentId,
    });

    if (selected) {
      toolPolicyKey = selected.policyKey;
      toolPolicyVersion = selected.version;
      allowSelectors.push(...selected.allowTools);
      denySelectors.push(...selected.denyTools);
    }
  }

  const normalizedAllowSelectors = sanitizeSelectors(allowSelectors);
  const normalizedDenySelectors = sanitizeSelectors(denySelectors);

  return {
    promptTemplateId,
    promptVersion,
    toolPolicyKey,
    toolPolicyVersion,
    allowSelectors: normalizedAllowSelectors,
    denySelectors: normalizedDenySelectors,
    governanceHash: createStableHash({
      promptTemplateId,
      promptVersion,
      toolPolicyKey,
      toolPolicyVersion,
      allowSelectors: normalizedAllowSelectors,
      denySelectors: normalizedDenySelectors,
    }),
  };
}

function isActionAllowedByGovernance(
  entry: AgentActionCatalogEntry,
  governance: ResolvedGovernanceEnvelope,
): boolean {
  const denied = governance.denySelectors.some((selector) => matchesAgentActionSelector(selector, entry));
  if (denied) {
    return false;
  }

  if (governance.allowSelectors.length === 0) {
    return true;
  }

  return governance.allowSelectors.some((selector) => matchesAgentActionSelector(selector, entry));
}

function mapActionMethodToResourcePermission(method: AgentActionCatalogEntry['method']): ResourcePermission {
  if (method === 'GET') {
    return 'read';
  }
  if (method === 'DELETE') {
    return 'delete';
  }
  return 'write';
}

function isPermissionSatisfied(requiredPermission: string, permissions: string[]): boolean {
  return permissions.includes(requiredPermission);
}

export async function listAuthorizedAgentActions(params: {
  auth: AuthContext;
  namespaceId?: string | null;
  agentId?: string | null;
  disabledActionKeys?: string[];
}): Promise<{
  envelope: EffectivePermissionEnvelope;
  governance: ResolvedGovernanceEnvelope;
  actions: AgentActionCatalogEntry[];
}> {
  const envelope = await resolveEffectivePermissionEnvelope(params.auth);
  const governance = await resolveGovernanceEnvelope({
    tenantId: envelope.tenantId,
    namespaceId: params.namespaceId,
    agentId: params.agentId,
  });
  const disabledKeys = new Set((params.disabledActionKeys ?? []).map((key) => key.trim()).filter(Boolean));

  const actions = listAgentActionCatalog().filter((entry) => {
    if (!entry.enabled) {
      return false;
    }
    if (disabledKeys.has(entry.actionKey)) {
      return false;
    }
    if (entry.allowedNamespaceIds && params.namespaceId && !entry.allowedNamespaceIds.includes(params.namespaceId)) {
      return false;
    }
    if (!isPermissionSatisfied(entry.requiredPermission, envelope.permissions)) {
      return false;
    }
    return isActionAllowedByGovernance(entry, governance);
  });

  return { envelope, governance, actions };
}

export async function authorizeAgentAction(params: {
  auth: AuthContext;
  actionKey: string;
  payload?: unknown;
  namespaceId?: string | null;
  agentId?: string | null;
  resourceId?: string | null;
  resourceType?: ResourceType | null;
  disabledActionKeys?: string[];
  serviceAccount?: ServiceAccountScope | null;
}): Promise<AuthorizedActionDecision> {
  const envelope = await resolveEffectivePermissionEnvelope(params.auth);
  const governance = await resolveGovernanceEnvelope({
    tenantId: envelope.tenantId,
    namespaceId: params.namespaceId,
    agentId: params.agentId,
  });
  const payloadHash = createAgentPayloadHash(params.payload ?? {});
  const entry = getAgentActionCatalogEntry(params.actionKey);

  if (!entry) {
    return {
      allowed: false,
      reason: 'catalog_not_found',
      action: null,
      payloadHash,
      authzDecisionId: null,
      envelope,
      governance,
    };
  }

  if (!entry.enabled || (params.disabledActionKeys ?? []).includes(entry.actionKey)) {
    return {
      allowed: false,
      reason: 'disabled',
      action: entry,
      payloadHash,
      authzDecisionId: null,
      envelope,
      governance,
    };
  }

  if (entry.allowedNamespaceIds && params.namespaceId && !entry.allowedNamespaceIds.includes(params.namespaceId)) {
    return {
      allowed: false,
      reason: 'namespace_denied',
      action: entry,
      payloadHash,
      authzDecisionId: null,
      envelope,
      governance,
    };
  }

  if (params.serviceAccount) {
    if (params.auth.userId) {
      return {
        allowed: false,
        reason: 'service_account_mask_forbidden',
        action: entry,
        payloadHash,
        authzDecisionId: null,
        envelope,
        governance,
      };
    }

    const serviceAccountAllowed = params.serviceAccount.enabled
      && params.serviceAccount.allowedActionKeys.includes(entry.actionKey)
      && (!params.serviceAccount.namespaceScope || !params.namespaceId || params.serviceAccount.namespaceScope.includes(params.namespaceId))
      && (!params.serviceAccount.agentScope || !params.agentId || params.serviceAccount.agentScope.includes(params.agentId));

    if (!serviceAccountAllowed) {
      return {
        allowed: false,
        reason: 'service_account_denied',
        action: entry,
        payloadHash,
        authzDecisionId: null,
        envelope,
        governance,
      };
    }
  }

  if (!isPermissionSatisfied(entry.requiredPermission, envelope.permissions)) {
    return {
      allowed: false,
      reason: 'permission_denied',
      action: entry,
      payloadHash,
      authzDecisionId: null,
      envelope,
      governance,
    };
  }

  if (!isActionAllowedByGovernance(entry, governance)) {
    return {
      allowed: false,
      reason: 'governance_denied',
      action: entry,
      payloadHash,
      authzDecisionId: null,
      envelope,
      governance,
    };
  }

  if (
    params.resourceId
    && params.resourceType
    && entry.resourceType !== 'none'
    && entry.resourceType === params.resourceType
  ) {
    const resourceDecision = await authorizeResourceAccess({
      actor: {
        ...params.auth,
        tenantId: envelope.tenantId,
        customRoleId: envelope.customRoleId ?? undefined,
      },
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      permission: mapActionMethodToResourcePermission(entry.method),
      tenantId: envelope.tenantId,
      namespaceId: params.namespaceId ?? undefined,
      agentId: params.agentId ?? undefined,
    });

    if (!resourceDecision.allowed) {
      return {
        allowed: false,
        reason: 'resource_denied',
        action: entry,
        payloadHash,
        authzDecisionId: null,
        envelope,
        governance,
        resourceDecision,
      };
    }

    return {
      allowed: true,
      reason: 'ok',
      action: entry,
      payloadHash,
      authzDecisionId: crypto.randomUUID(),
      envelope,
      governance,
      resourceDecision,
    };
  }

  return {
    allowed: true,
    reason: 'ok',
    action: entry,
    payloadHash,
    authzDecisionId: crypto.randomUUID(),
    envelope,
    governance,
  };
}

function encodeDelegatedClaims(claims: DelegatedExecutionTokenClaims): string {
  if (!DELEGATED_TOKEN_SECRET) {
    throw new Error('INTERNAL_API_SECRET não configurado para token delegado');
  }

  const serialized = JSON.stringify(claims);
  const encoded = Buffer.from(serialized, 'utf-8').toString('base64url');
  const signature = crypto.createHmac('sha256', DELEGATED_TOKEN_SECRET).update(encoded).digest('hex');
  return `${encoded}.${signature}`;
}

function decodeDelegatedClaims(token: string): DelegatedExecutionTokenClaims {
  if (!DELEGATED_TOKEN_SECRET) {
    throw new Error('INTERNAL_API_SECRET não configurado para token delegado');
  }
  const separatorIndex = token.lastIndexOf('.');
  if (separatorIndex === -1) {
    throw new Error('DELEGATED_TOKEN_INVALID');
  }
  const encoded = token.slice(0, separatorIndex);
  const providedSignature = token.slice(separatorIndex + 1);
  const expectedSignature = crypto.createHmac('sha256', DELEGATED_TOKEN_SECRET).update(encoded).digest('hex');

  if (
    providedSignature.length !== expectedSignature.length
    || !crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))
  ) {
    throw new Error('DELEGATED_TOKEN_INVALID');
  }

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as DelegatedExecutionTokenClaims;
  return payload;
}

export async function issueDelegatedExecutionToken(params: {
  decision: AuthorizedActionDecision;
  conversationId?: string | null;
  sessionId?: string | null;
  approvalRequestId?: string | null;
  namespaceId?: string | null;
  agentId?: string | null;
  resourceId?: string | null;
  resourceType?: string | null;
  stepUpContext?: Record<string, unknown> | null;
}): Promise<{ token: string; claims: DelegatedExecutionTokenClaims }> {
  if (!params.decision.allowed || !params.decision.action) {
    throw new Error('AUTHZ_DECISION_REQUIRED_FOR_DELEGATED_TOKEN');
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (Math.max(30, DELEGATED_TOKEN_TTL_SECONDS) * 1000));
  const claims: DelegatedExecutionTokenClaims = {
    tokenId: crypto.randomUUID(),
    actorUserId: params.decision.envelope.userId,
    tenantId: params.decision.envelope.tenantId,
    baseRole: params.decision.envelope.baseRole,
    customRoleId: params.decision.envelope.customRoleId,
    permissionsVersion: params.decision.envelope.permissionsVersion,
    grantsVersion: params.decision.envelope.grantsVersion,
    permissionSnapshotHash: params.decision.envelope.permissionSnapshotHash,
    conversationId: params.conversationId ?? null,
    namespaceId: params.namespaceId ?? null,
    agentId: params.agentId ?? null,
    actionKey: params.decision.action.actionKey,
    capabilityId: params.decision.action.capabilityId,
    requiredPermission: params.decision.action.requiredPermission,
    resourceType: params.resourceType ?? (typeof params.decision.action.resourceType === 'string' ? params.decision.action.resourceType : null),
    resourceId: params.resourceId ?? null,
    riskLevel: params.decision.action.riskLevel,
    requiresApproval: params.decision.action.requiresApproval,
    requiresStepUp: params.decision.action.requiresStepUp,
    requiresDualControl: params.decision.action.requiresDualControl,
    toolPolicyKey: params.decision.governance.toolPolicyKey,
    toolPolicyVersion: params.decision.governance.toolPolicyVersion,
    promptTemplateId: params.decision.governance.promptTemplateId,
    promptVersion: params.decision.governance.promptVersion,
    governanceHash: params.decision.governance.governanceHash,
    payloadHash: params.decision.payloadHash,
    approvalRequestId: params.approvalRequestId ?? null,
    sessionId: params.sessionId ?? null,
    stepUpContext: params.stepUpContext ?? null,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    singleUse: true,
  };

  return {
    token: encodeDelegatedClaims(claims),
    claims,
  };
}

export function buildDelegatedExecutionHeaders(params: {
  auth: AuthContext;
  delegatedToken: string;
}): Record<string, string> {
  const internal = generateInternalAuthHeaders(params.auth);
  return {
    'X-Internal-Signature': internal['x-internal-signature'],
    'X-Internal-Timestamp': internal['x-internal-timestamp'],
    'X-Internal-User-Id': internal['x-internal-user-id'],
    'X-Internal-Role': internal['x-internal-role'],
    ...(internal['x-internal-tenant-id'] ? { 'X-Internal-Tenant-Id': internal['x-internal-tenant-id'] } : {}),
    ...(internal['x-internal-custom-role-id'] ? { 'X-Internal-Custom-Role-Id': internal['x-internal-custom-role-id'] } : {}),
    'X-Delegated-Execution-Token': params.delegatedToken,
  };
}

export async function auditDelegatedAuthorization(params: {
  auth: AuthContext;
  decision: AuthorizedActionDecision;
  requestId?: string | null;
  conversationId?: string | null;
  actionRequestId?: string | null;
  sourceService: string;
  eventType: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  if (!params.decision.action || !params.auth.tenantId) {
    return;
  }

  try {
    await appendImmutableAuditEvent({
      db: getDatabase(),
      input: {
        tenantId: params.auth.tenantId,
        actorUserId: params.auth.userId,
        sourceService: params.sourceService,
        stream: 'agentic_delegated_actions',
        streamKey: params.conversationId ?? params.actionRequestId ?? params.decision.action.actionKey,
        eventType: params.eventType,
        resourceType: params.decision.action.module,
        resourceId: params.actionRequestId ?? params.decision.action.actionKey,
        requestId: params.requestId ?? null,
        payload: {
          actionKey: params.decision.action.actionKey,
          capabilityId: params.decision.action.capabilityId,
          requiredPermission: params.decision.action.requiredPermission,
          permissionsVersion: params.decision.envelope.permissionsVersion,
          grantsVersion: params.decision.envelope.grantsVersion,
          payloadHash: params.decision.payloadHash,
          governanceHash: params.decision.governance.governanceHash,
          decisionReason: params.decision.reason,
          ...params.payload,
        },
      },
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao gravar auditoria imutável da autorização delegada');
  }
}

async function consumeSingleUseMarker(claims: DelegatedExecutionTokenClaims): Promise<boolean> {
  if (!claims.singleUse) {
    return true;
  }

  const redis = getRedisClient();
  if (!redis) {
    throw new Error('DELEGATED_TOKEN_REDIS_UNAVAILABLE');
  }

  const expiresInMs = Math.max(1000, new Date(claims.expiresAt).getTime() - Date.now());
  const key = `${DELEGATED_TOKEN_CONSUME_PREFIX}:${claims.tokenId}`;
  const result = await redis.set(key, claims.actorUserId, { NX: true, PX: expiresInMs });
  return result === 'OK';
}

async function validateApprovalState(approvalRequestId: string, payloadHash: string): Promise<boolean> {
  const db = getDatabase();
  const actionRequest = await db.query.actionRequests.findFirst({
    where: eq(schema.actionRequests.id, approvalRequestId),
    columns: {
      id: true,
      status: true,
      payload: true,
      tenantId: true,
    },
  });

  if (!actionRequest) {
    return false;
  }

  if (!['approved', 'executed'].includes(actionRequest.status)) {
    return false;
  }

  const payload = (actionRequest.payload ?? {}) as Record<string, unknown>;
  const authz = payload.authz;
  if (authz && typeof authz === 'object') {
    const storedPayloadHash = typeof (authz as { payloadHash?: unknown }).payloadHash === 'string'
      ? (authz as { payloadHash: string }).payloadHash
      : null;
    if (storedPayloadHash && storedPayloadHash !== payloadHash) {
      return false;
    }
  }

  return true;
}

export async function verifyDelegatedExecutionToken(params: {
  delegatedToken?: string | null;
  auth: AuthContext;
  actionKey: string;
  payload?: unknown;
  namespaceId?: string | null;
  agentId?: string | null;
  resourceType?: ResourceType | null;
  resourceId?: string | null;
}): Promise<DelegatedExecutionVerificationResult> {
  if (!params.delegatedToken) {
    return {
      ok: false,
      code: 'DELEGATED_TOKEN_REQUIRED',
      status: 401,
      message: 'Token delegado obrigatório para esta ação agentic',
    };
  }

  let claims: DelegatedExecutionTokenClaims;
  try {
    claims = decodeDelegatedClaims(params.delegatedToken);
  } catch (error) {
    return {
      ok: false,
      code: 'DELEGATED_TOKEN_INVALID',
      status: 401,
      message: error instanceof Error ? error.message : 'Token delegado inválido',
    };
  }

  if (new Date(claims.expiresAt).getTime() <= Date.now()) {
    return {
      ok: false,
      code: 'DELEGATED_TOKEN_EXPIRED',
      status: 401,
      message: 'Token delegado expirado',
    };
  }

  if (claims.actionKey !== params.actionKey) {
    return {
      ok: false,
      code: 'DELEGATED_TOKEN_ACTION_MISMATCH',
      status: 409,
      message: 'Token delegado não corresponde à ação solicitada',
    };
  }

  if (
    claims.actorUserId !== params.auth.userId
    || claims.tenantId !== params.auth.tenantId
    || claims.baseRole !== params.auth.role
  ) {
    return {
      ok: false,
      code: 'DELEGATED_TOKEN_ACTOR_MISMATCH',
      status: 409,
      message: 'Token delegado não corresponde ao ator autenticado',
    };
  }

  const expectedPayloadHash = createAgentPayloadHash(params.payload ?? {});
  if (claims.payloadHash !== expectedPayloadHash) {
    return {
      ok: false,
      code: 'DELEGATED_TOKEN_PAYLOAD_MISMATCH',
      status: 409,
      message: 'Payload divergente do aprovado na pré-autorização',
    };
  }

  let consumed = false;
  try {
    consumed = await consumeSingleUseMarker(claims);
  } catch (error) {
    if (error instanceof Error && error.message === 'DELEGATED_TOKEN_REDIS_UNAVAILABLE') {
      return {
        ok: false,
        code: 'DELEGATED_TOKEN_REDIS_UNAVAILABLE',
        status: 503,
        message: 'Redis indisponível para validar token delegado single-use',
      };
    }
    throw error;
  }
  if (!consumed) {
    return {
      ok: false,
      code: 'DELEGATED_TOKEN_REUSED',
      status: 409,
      message: 'Token delegado já foi consumido',
    };
  }

  const envelope = await resolveEffectivePermissionEnvelope(params.auth);
  if (
    envelope.permissionsVersion !== claims.permissionsVersion
    || envelope.grantsVersion !== claims.grantsVersion
    || envelope.permissionSnapshotHash !== claims.permissionSnapshotHash
  ) {
    return {
      ok: false,
      code: 'DELEGATED_TOKEN_REVOKED',
      status: 403,
      message: 'Permissões ou grants foram alterados após a emissão do token delegado',
    };
  }

  const governance = await resolveGovernanceEnvelope({
    tenantId: envelope.tenantId,
    namespaceId: claims.namespaceId ?? params.namespaceId,
    agentId: claims.agentId ?? params.agentId,
  });
  if (governance.governanceHash !== claims.governanceHash) {
    return {
      ok: false,
      code: 'DELEGATED_TOKEN_GOVERNANCE_MISMATCH',
      status: 403,
      message: 'Governança mudou após a emissão do token delegado',
    };
  }

  const action = getAgentActionCatalogEntry(claims.actionKey);
  if (!action) {
    return {
      ok: false,
      code: 'DELEGATED_TOKEN_INVALID',
      status: 401,
      message: 'Catálogo da ação delegada não encontrado',
    };
  }

  if (!isPermissionSatisfied(action.requiredPermission, envelope.permissions) || action.requiredPermission !== claims.requiredPermission) {
    return {
      ok: false,
      code: 'DELEGATED_TOKEN_REVOKED',
      status: 403,
      message: 'Permissão requerida não está mais válida para o ator autenticado',
    };
  }

  if (!isActionAllowedByGovernance(action, governance)) {
    return {
      ok: false,
      code: 'DELEGATED_TOKEN_GOVERNANCE_MISMATCH',
      status: 403,
      message: 'Ação negada pela governança atual',
    };
  }

  if (claims.approvalRequestId) {
    const approvalStateValid = await validateApprovalState(claims.approvalRequestId, claims.payloadHash);
    if (!approvalStateValid) {
      return {
        ok: false,
        code: 'DELEGATED_TOKEN_APPROVAL_INVALID',
        status: 403,
        message: 'Aprovação transacional inválida ou expirada',
      };
    }
  }

  if (claims.requiresStepUp) {
    const verifiedAt = typeof claims.stepUpContext?.verifiedAt === 'string'
      ? new Date(claims.stepUpContext.verifiedAt).getTime()
      : Number.NaN;
    const actionRequestMatch = claims.approvalRequestId
      ? claims.stepUpContext?.actionRequestId === claims.approvalRequestId
      : true;
    if (!Number.isFinite(verifiedAt) || !actionRequestMatch) {
      return {
        ok: false,
        code: 'DELEGATED_TOKEN_APPROVAL_INVALID',
        status: 403,
        message: 'Step-up obrigatório ausente ou incompatível com a aprovação transacional',
      };
    }
  }

  if (
    params.resourceId
    && params.resourceType
    && action.resourceType === params.resourceType
  ) {
    const resourceDecision = await authorizeResourceAccess({
      actor: {
        ...params.auth,
        tenantId: envelope.tenantId,
        customRoleId: envelope.customRoleId ?? undefined,
      },
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      permission: mapActionMethodToResourcePermission(action.method),
      tenantId: envelope.tenantId,
      namespaceId: claims.namespaceId ?? params.namespaceId ?? undefined,
      agentId: claims.agentId ?? params.agentId ?? undefined,
    });

    if (!resourceDecision.allowed) {
      return {
        ok: false,
        code: 'DELEGATED_TOKEN_RESOURCE_DENIED',
        status: 403,
        message: 'Recurso alvo não autorizado para o ator autenticado',
      };
    }
  }

  return {
    ok: true,
    claims,
    action,
    envelope,
    governance,
  };
}

export function extractDelegatedExecutionToken(headers: Record<string, string | string[] | undefined>): string | null {
  const raw = headers['x-delegated-execution-token'];
  if (Array.isArray(raw)) {
    return raw[0] ?? null;
  }
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

export function toTitleCaseActionLabel(entry: AgentActionCatalogEntry): string {
  return entry.actionKey.replace(/\./g, ' > ');
}
