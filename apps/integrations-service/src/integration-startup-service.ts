import { and, eq, getDatabase, schema } from '@alice/database';
import type { IntegrationConfiguracao } from '@alice/shared';
import {
  initializeRedisCache,
  initializeSessionAuthCache,
} from '@alice/shared-utils';
import * as kucoinClient from './kucoinClient.js';

type StartupLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type IntegrationSeed = {
  tipo: 'kucoin';
  nome: string;
  configuracao: IntegrationConfiguracao;
  credenciais: Record<string, unknown>;
};

export function createIntegrationStartupOrchestrator(logger: StartupLogger) {
  function buildIntegrationSeeds(): IntegrationSeed[] {
    const seeds: IntegrationSeed[] = [];
    const kucoinStatus = kucoinClient.getKucoinConfigStatus();
    if (kucoinStatus.isConfigured) {
      const baseUrl = process.env.KUCOIN_PRO_BASE_URL?.trim();
      const configuracao: IntegrationConfiguracao = {};
      if (baseUrl) {
        configuracao.baseUrl = baseUrl;
      }
      seeds.push({
        tipo: 'kucoin',
        nome: 'KuCoin Futures',
        configuracao,
        credenciais: {
          apiKey: process.env.KUCOIN_PRO_API_KEY?.trim(),
          apiSecret: process.env.KUCOIN_PRO_API_SECRET?.trim(),
          passphrase: process.env.KUCOIN_PRO_API_PASSPHRASE?.trim(),
        },
      });
    } else {
      logger.warn({ missing: kucoinStatus.missingKeys }, 'KuCoin não configurado - bootstrap ignorado');
    }

    return seeds;
  }

  async function ensureIntegrationSeeded(params: {
    tenantId: string;
    seed: IntegrationSeed;
  }): Promise<boolean> {
    const db = getDatabase();
    const existing = await db.query.integrations.findFirst({
      where: and(
        eq(schema.integrations.tenantId, params.tenantId),
        eq(schema.integrations.tipo, params.seed.tipo)
      ),
    });

    if (existing) {
      return false;
    }

    const [created] = await db.insert(schema.integrations).values({
      tenantId: params.tenantId,
      tipo: params.seed.tipo,
      nome: params.seed.nome,
      configuracao: params.seed.configuracao,
      credenciais: params.seed.credenciais,
      ativo: true,
    }).returning();

    if (!created) {
      throw new Error(`Falha ao criar integração ${params.seed.tipo} para o tenant ${params.tenantId}`);
    }

    logger.info({ tenantId: params.tenantId, tipo: params.seed.tipo }, 'Integração bootstrap criada');
    return true;
  }

  async function bootstrapIntegrationsForTenants(): Promise<void> {
    const db = getDatabase();
    const tenants = await db.query.tenants.findMany({
      columns: {
        id: true,
        nome: true,
      },
    });

    if (tenants.length === 0) {
      logger.warn('Nenhum tenant encontrado para bootstrap de integrações');
      return;
    }

    const seeds = buildIntegrationSeeds();
    if (seeds.length === 0) {
      logger.warn('Nenhuma integração configurada para bootstrap');
      return;
    }

    for (const tenant of tenants) {
      for (const seed of seeds) {
        try {
          await ensureIntegrationSeeded({ tenantId: tenant.id, seed });
        } catch (error) {
          logger.error(
            { error, tenantId: tenant.id, tipo: seed.tipo },
            'Falha ao bootstrapar integração'
          );
        }
      }
    }
  }

  // =============================================================================
  // INICIALIZAÇÃO: Redis Cache + Session Auth Cache
  // =============================================================================
  // CORREÇÃO PR#107 (10/01/2026): Inicializar caches antes de processar requisições
  // Redis cache é usado para performance de sessões HTTP (evita queries repetitivas)
  // =============================================================================
  async function initializeCaches(): Promise<void> {
    // initializeRedisCache() usa REDIS_URL do ambiente automaticamente.
    // - Em produção: fail-fast se Redis indisponível (Regra 6)
    // - Em dev/test: Redis pode estar ausente; session-auth cache fica desabilitado (sem in-memory)
    const redisConnected = await initializeRedisCache();
    logger.info({ redisConnected }, 'Redis cache inicializado');

    await initializeSessionAuthCache();
    logger.info('Session auth cache inicializado');
  }

  return {
    bootstrapIntegrationsForTenants,
    initializeCaches,
  };
}
