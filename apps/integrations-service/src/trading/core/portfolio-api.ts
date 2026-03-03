import { and, desc, eq, getDatabase, schema } from '@alice/database';

export async function listTenantPortfolios(tenantId: string) {
  const db = getDatabase();
  return db.query.tradingPortfolios.findMany({
    where: eq(schema.tradingPortfolios.tenantId, tenantId),
    orderBy: [desc(schema.tradingPortfolios.createdAt)],
  });
}

export async function getPortfolioAllocations(tenantId: string, portfolioId: string) {
  const db = getDatabase();
  return db.query.tradingPortfolioAllocations.findMany({
    where: and(
      eq(schema.tradingPortfolioAllocations.tenantId, tenantId),
      eq(schema.tradingPortfolioAllocations.portfolioId, portfolioId),
    ),
  });
}
