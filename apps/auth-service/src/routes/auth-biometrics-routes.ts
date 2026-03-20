import type { Express, Request, Response, RequestHandler } from 'express';
import type { SafeParseReturnType } from 'zod';
import { requireAuth } from '@alice/shared-utils';
import type { AuthContext } from '@alice/shared-utils';
import { createLogger } from '@alice/logger';
import { writeApprovalStepUpSession } from '../auth-step-up-session.js';

interface BiometricsLoginBody {
  email: string;
  imageBase64: string;
}

interface BiometricsImageBody {
  imageBase64: string;
  captureMode?: 'replace' | 'append';
}

interface BiometricsVerifyBody {
  imageBase64: string;
  actionType: 'login' | 'approval';
  actionContext?: Record<string, unknown>;
}

interface RegisterAuthBiometricsRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  biometricsLoginRateLimiter: RequestHandler;
  parseBiometricsLogin: (input: unknown) => SafeParseReturnType<unknown, BiometricsLoginBody>;
  parseBiometricsImage: (input: unknown) => SafeParseReturnType<unknown, BiometricsImageBody>;
  parseBiometricsVerify: (input: unknown) => SafeParseReturnType<unknown, BiometricsVerifyBody>;
  getUserByEmail: (email: string) => Promise<unknown | null>;
  buildAuthContext: (user: unknown) => Promise<AuthContext>;
  callBiometricsService: (endpoint: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  resolveBiometricsError: (error: unknown) => { status: number; message: string };
}

export function registerAuthBiometricsRoutes(
  app: Express,
  deps: RegisterAuthBiometricsRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('auth-service');
  const {
    biometricsLoginRateLimiter,
    parseBiometricsLogin,
    parseBiometricsImage,
    parseBiometricsVerify,
    getUserByEmail,
    buildAuthContext,
    callBiometricsService,
    resolveBiometricsError,
  } = deps;

  app.post('/api/auth/biometrics/login', biometricsLoginRateLimiter, async (req: Request, res: Response) => {
    const parsed = parseBiometricsLogin(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    try {
      const dbUser = await getUserByEmail(parsed.data.email);
      if (!dbUser) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }
      const authContext = await buildAuthContext(dbUser);
      const verifyResult = await callBiometricsService('/verify', {
        userId: authContext.userId,
        tenantId: authContext.tenantId,
        imageBase64: parsed.data.imageBase64,
        actionType: 'login',
        actionContext: { ip: req.ip },
      });
      if (verifyResult.match !== true) {
        return res.status(401).json({ error: 'Biometria não reconhecida' });
      }

      req.login(authContext, (err) => {
        if (err) {
          logger.error({ err }, 'Falha ao iniciar sessão biométrica');
          return res.status(500).json({ error: 'Falha ao iniciar sessão' });
        }
        return res.json({ user: authContext });
      });
      return undefined;
    } catch (error) {
      const mapped = resolveBiometricsError(error);
      logger.error({ error: mapped.message, status: mapped.status }, 'Falha no login biometrico');
      return res.status(mapped.status).json({ error: mapped.message });
    }
  });

  app.post('/api/auth/biometrics/status', requireAuth(), async (req: Request, res: Response) => {
    try {
      const auth = req.user as AuthContext;
      const result = await callBiometricsService('/status', {
        userId: auth.userId,
        tenantId: auth.tenantId,
      });
      return res.json(result);
    } catch (error) {
      const mapped = resolveBiometricsError(error);
      return res.status(mapped.status).json({ error: mapped.message });
    }
  });

  app.post('/api/auth/biometrics/enroll', requireAuth(), async (req: Request, res: Response) => {
    const parsed = parseBiometricsImage(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Imagem inválida', details: parsed.error.flatten() });
    }
    try {
      const auth = req.user as AuthContext;
      const result = await callBiometricsService('/enroll', {
        userId: auth.userId,
        tenantId: auth.tenantId,
        imageBase64: parsed.data.imageBase64,
        captureMode: parsed.data.captureMode,
      });
      return res.json(result);
    } catch (error) {
      const mapped = resolveBiometricsError(error);
      return res.status(mapped.status).json({ error: mapped.message });
    }
  });

  app.post('/api/auth/biometrics/verify', requireAuth(), async (req: Request, res: Response) => {
    const parsed = parseBiometricsVerify(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    try {
      const auth = req.user as AuthContext;
      const result = await callBiometricsService('/verify', {
        userId: auth.userId,
        tenantId: auth.tenantId,
        imageBase64: parsed.data.imageBase64,
        actionType: parsed.data.actionType,
        actionContext: parsed.data.actionContext,
      });
      if (parsed.data.actionType === 'approval' && result.match === true) {
        const actionRequestId = typeof parsed.data.actionContext?.actionRequestId === 'string'
          ? parsed.data.actionContext.actionRequestId
          : null;
        writeApprovalStepUpSession(req, {
          method: 'biometric',
          actionRequestId,
        });
      }
      return res.json(result);
    } catch (error) {
      const mapped = resolveBiometricsError(error);
      return res.status(mapped.status).json({ error: mapped.message });
    }
  });
}
