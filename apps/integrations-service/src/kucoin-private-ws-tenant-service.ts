import { and, eq, getDatabase, schema } from '@alice/database';

type KucoinPrivateWsLogger = {
  warn: (...args: unknown[]) => void;
};

export function createResolveKucoinTenantIdForPrivateWs(logger: KucoinPrivateWsLogger) {
  return async function resolveKucoinTenantIdForPrivateWs(): Promise<string | null> {
    const db = getDatabase();
    const integrations = await db
      .select()
      .from(schema.integrations)
      .where(
        and(
          eq(schema.integrations.tipo, 'kucoin'),
          eq(schema.integrations.ativo, true)
        )
      );

    if (integrations.length === 0) {
      logger.warn('Nenhuma integração KuCoin ativa encontrada para WS privado');
      return null;
    }

    if (integrations.length === 1) {
      return integrations[0]?.tenantId ?? null;
    }

    const apiKey = process.env.KUCOIN_PRO_API_KEY?.trim();
    if (apiKey) {
      const matched = integrations.find((integration) => integration.credenciais?.apiKey === apiKey);
      if (matched?.tenantId) {
        return matched.tenantId;
      }
    }

    logger.warn(
      { total: integrations.length },
      'Múltiplas integrações KuCoin ativas - tenant para WS privado não resolvido'
    );
    return null;
  };
}
