import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import { z } from 'zod';

const wiseOAuthExchangeSchema = z.object({
  code: z.string().min(5, 'code inválido'),
  redirectUri: z.string().url('redirectUri inválido'),
});

const wiseOAuthRefreshSchema = z.object({
  refreshToken: z.string().min(10, 'refreshToken inválido'),
});

interface RegisterWiseOAuthRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  getSandboxStatus: () => boolean;
  getProfileIdSafe: () => string | null | undefined;
  exchangeRegistrationCode: (params: z.infer<typeof wiseOAuthExchangeSchema>) => Promise<unknown>;
  exchangeAuthorizationCode: (params: z.infer<typeof wiseOAuthExchangeSchema>) => Promise<unknown>;
  refreshUserToken: (refreshToken: string) => Promise<unknown>;
}

export function registerWiseOAuthRoutes(
  app: Express,
  deps: RegisterWiseOAuthRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    getSandboxStatus,
    getProfileIdSafe,
    exchangeRegistrationCode,
    exchangeAuthorizationCode,
    refreshUserToken,
  } = deps;

  app.post('/api/integrations/wise/oauth/exchange-registration-code', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const bodyParsed = wiseOAuthExchangeSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
    }
    try {
      const token = await exchangeRegistrationCode(bodyParsed.data);
      res.json({ token });
    } catch (error) {
      logger.error({ error }, 'Falha ao trocar registration code Wise');
      res.status(500).json({ error: 'Falha ao trocar registration code' });
    }
  });

  app.post('/api/integrations/wise/oauth/exchange-authorization-code', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const bodyParsed = wiseOAuthExchangeSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
    }
    try {
      const token = await exchangeAuthorizationCode(bodyParsed.data);
      res.json({ token });
    } catch (error) {
      logger.error({ error }, 'Falha ao trocar authorization code Wise');
      res.status(500).json({ error: 'Falha ao trocar authorization code' });
    }
  });

  app.post('/api/integrations/wise/oauth/refresh-user-token', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const bodyParsed = wiseOAuthRefreshSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
    }
    try {
      const token = await refreshUserToken(bodyParsed.data.refreshToken);
      res.json({ token });
    } catch (error) {
      logger.error({ error }, 'Falha ao renovar token Wise');
      res.status(500).json({ error: 'Falha ao renovar token' });
    }
  });

  // Status do Wise (não requer configuração para retornar status)
  app.get('/api/integrations/wise/status', requirePermission('integrations:wise:read'), (_req: Request, res: Response) => {
    const profileId = getProfileIdSafe();
    res.json({
      configured: isWiseConfigured(),
      sandbox: getSandboxStatus(),
      profileId: profileId ? `***${profileId.slice(-4)}` : null,
    });
  });
}
