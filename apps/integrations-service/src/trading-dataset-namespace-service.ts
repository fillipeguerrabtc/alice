export function createTradingDatasetNamespaceService(deps: {
  resolveTradingNamespaceId: (tenantId: string) => Promise<string | null>;
  validateTenantNamespace: (tenantId: string, namespaceId: string) => Promise<boolean>;
  namespaceInferenceConfidence: number;
}) {
  async function resolveDatasetNamespace(params: {
    tenantId: string;
    preferredNamespaceIds: Array<string | null | undefined>;
  }): Promise<{ namespaceId: string | null; inferenceConfidence: number | null }> {
    const namespaceCandidates = params.preferredNamespaceIds.filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );

    let namespaceId: string | null = null;
    for (const candidate of namespaceCandidates) {
      if (await deps.validateTenantNamespace(params.tenantId, candidate)) {
        namespaceId = candidate;
        break;
      }
    }

    if (namespaceId) {
      return { namespaceId, inferenceConfidence: null };
    }

    const inferredNamespaceId = await deps.resolveTradingNamespaceId(params.tenantId);
    if (inferredNamespaceId && await deps.validateTenantNamespace(params.tenantId, inferredNamespaceId)) {
      return {
        namespaceId: inferredNamespaceId,
        inferenceConfidence: deps.namespaceInferenceConfidence,
      };
    }

    return {
      namespaceId: null,
      inferenceConfidence: null,
    };
  }

  return {
    resolveDatasetNamespace,
  };
}
