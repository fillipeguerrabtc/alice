import { getDatabase } from '@alice/database';

export async function loadStrategyRegistry() {
  const db = getDatabase();
  return db.query.tradingStrategyRegistry.findMany();
}
