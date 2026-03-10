import { getDatabase, schema, eq, and, inArray, desc, sql } from '@alice/database';

type TradingProfileKind = 'analysis' | 'signal';
type TradingSourceType = typeof schema.trainingData.$inferSelect.sourceType;

export function createTradingScopeProfileService(deps: {
  truncateText: (input: string, maxLength: number) => string;
  tradingSourceTypes: readonly TradingSourceType[];
}) {
  async function resolveTradingNamespaceId(tenantId: string): Promise<string | null> {
    const db = getDatabase();
    const ns = await db.query.namespaces.findFirst({
      where: and(
        eq(schema.namespaces.tenantId, tenantId),
        eq(schema.namespaces.slug, 'trading'),
        eq(schema.namespaces.ativo, true)
      ),
      columns: { id: true },
    });
    return ns?.id ?? null;
  }

  async function fetchTradingDatasetSummary(tenantId: string, namespaceId: string): Promise<{
    totalApproved: number;
    samples: Array<{ prompt: string; response: string; actionType: string; createdAt: string }>;
  }> {
    const db = getDatabase();
    const [total] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(and(
        eq(schema.trainingData.tenantId, tenantId),
        eq(schema.trainingData.namespaceId, namespaceId),
        eq(schema.trainingData.status, 'approved'),
        inArray(schema.trainingData.sourceType, [...deps.tradingSourceTypes])
      ));

    const samples = await db.query.trainingData.findMany({
      where: and(
        eq(schema.trainingData.tenantId, tenantId),
        eq(schema.trainingData.namespaceId, namespaceId),
        eq(schema.trainingData.status, 'approved'),
        inArray(schema.trainingData.sourceType, [...deps.tradingSourceTypes])
      ),
      orderBy: [desc(schema.trainingData.criadoEm)],
      limit: 3,
    });

    return {
      totalApproved: Number(total?.count ?? 0),
      samples: samples.map((item) => {
        const msgs = (item.messages ?? []) as Array<{ role: string; content: string }>;
        const userMsg = msgs.find((m) => m.role === 'user');
        const assistantMsg = msgs.find((m) => m.role === 'assistant');
        const actionType = (item.sourceMetadata as Record<string, unknown>)?.actionType as string ?? 'unknown';
        return {
          prompt: deps.truncateText(userMsg?.content ?? '', 400),
          response: deps.truncateText(assistantMsg?.content ?? '', 400),
          actionType,
          createdAt: item.criadoEm?.toISOString?.() ?? new Date().toISOString(),
        };
      }),
    };
  }

  async function getOrCreateTradingProfile(
    tenantId: string,
    kind: TradingProfileKind
  ): Promise<schema.TradingAnalysisProfile> {
    const db = getDatabase();
    const existing = await db.query.tradingAnalysisProfiles.findFirst({
      where: and(
        eq(schema.tradingAnalysisProfiles.tenantId, tenantId),
        eq(schema.tradingAnalysisProfiles.kind, kind)
      ),
    });
    if (existing) return existing;

    const [created] = await db
      .insert(schema.tradingAnalysisProfiles)
      .values({ tenantId, kind })
      .returning();
    if (!created) {
      throw new Error('Falha ao criar perfil de análise/sinal');
    }
    return created;
  }

  async function validateTenantNamespace(tenantId: string, namespaceId: string): Promise<boolean> {
    const db = getDatabase();
    const namespace = await db.query.namespaces.findFirst({
      where: and(
        eq(schema.namespaces.id, namespaceId),
        eq(schema.namespaces.tenantId, tenantId),
      ),
      columns: { id: true },
    });
    return Boolean(namespace);
  }

  return {
    resolveTradingNamespaceId,
    fetchTradingDatasetSummary,
    getOrCreateTradingProfile,
    validateTenantNamespace,
  };
}
