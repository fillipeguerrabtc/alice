import type { Express, Request, Response } from 'express';
import { getDatabase, schema } from '@alice/database';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

interface RegisterIntegrationRegistryRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
}

const integrationQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

const createIntegrationSchema = z.object({
  tenantId: z.string().uuid().optional(),
  tipo: z.enum(['stripe', 'twilio', 'whatsapp']),
  nome: z.string().min(1),
  configuracao: z.record(z.unknown()).optional(),
  credenciais: z.record(z.unknown()).optional(),
});

export function registerIntegrationRegistryRoutes(
  app: Express,
  deps: RegisterIntegrationRegistryRoutesDeps = {},
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations', requirePermission('integrations:integrations:read'), async (req: Request, res: Response) => {
    const queryResult = integrationQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
    }
    const { tenantId } = queryResult.data;

    try {
      const db = getDatabase();
      const integrations = await db.query.integrations.findMany({
        where: tenantId ? eq(schema.integrations.tenantId, tenantId) : undefined,
        orderBy: [desc(schema.integrations.criadoEm)],
      });

      res.json({ integrations });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch integrations');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/integrations', requirePermission('integrations:integrations:write'), async (req: Request, res: Response) => {
    try {
      const body = createIntegrationSchema.parse(req.body);
      const db = getDatabase();

      const [integration] = await db.insert(schema.integrations).values({
        tenantId: body.tenantId,
        tipo: body.tipo,
        nome: body.nome,
        configuracao: body.configuracao || {},
        credenciais: body.credenciais || {},
        ativo: true,
      }).returning();

      logger.info({ integrationId: integration.id, tipo: body.tipo }, 'Integration created');
      res.json({ integration });
    } catch (error) {
      logger.error({ error }, 'Failed to create integration');
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}
