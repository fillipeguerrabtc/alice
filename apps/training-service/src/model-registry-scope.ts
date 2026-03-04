import { and, eq, isNull, schema, type SQL } from '@alice/database';

export interface ModelRegistryScope {
  namespaceId?: string | null;
  agentId?: string | null;
}

export interface NormalizedModelRegistryScope {
  namespaceId: string | null;
  agentId: string | null;
}

export function normalizeModelRegistryScope(scope?: ModelRegistryScope): NormalizedModelRegistryScope {
  return {
    namespaceId: scope?.namespaceId ?? null,
    agentId: scope?.agentId ?? null,
  };
}

export function assertValidModelRegistryScope(scope?: ModelRegistryScope): NormalizedModelRegistryScope {
  const normalized = normalizeModelRegistryScope(scope);
  if (normalized.agentId && !normalized.namespaceId) {
    throw new Error('Escopo invalido: agentId exige namespaceId no model registry');
  }
  return normalized;
}

export function buildModelVersionScopeCondition(scope?: ModelRegistryScope): SQL {
  const normalized = normalizeModelRegistryScope(scope);
  return and(
    normalized.namespaceId
      ? eq(schema.modelVersions.namespaceId, normalized.namespaceId)
      : isNull(schema.modelVersions.namespaceId),
    normalized.agentId
      ? eq(schema.modelVersions.agentId, normalized.agentId)
      : isNull(schema.modelVersions.agentId)
  ) as SQL;
}

export function buildFineTuningScopeCondition(scope?: ModelRegistryScope): SQL {
  const normalized = normalizeModelRegistryScope(scope);
  return and(
    normalized.namespaceId
      ? eq(schema.fineTuningJobs.scopeNamespaceId, normalized.namespaceId)
      : isNull(schema.fineTuningJobs.scopeNamespaceId),
    normalized.agentId
      ? eq(schema.fineTuningJobs.scopeAgentId, normalized.agentId)
      : isNull(schema.fineTuningJobs.scopeAgentId)
  ) as SQL;
}
