import type { Express, Request, Response, RequestHandler } from 'express';
import type { SafeParseReturnType } from 'zod';
import { requireAuth } from '@alice/shared-utils';
import type { AuthContext } from '@alice/shared-utils';
import { createLogger } from '@alice/logger';
import type { PassportStatic } from 'passport';
import { writeApprovalStepUpSession } from '../auth-step-up-session.js';

interface VerifyPasswordBody {
  password: string;
  actionContext?: Record<string, unknown>;
}

interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

interface RegisterAuthPasswordRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  passport: PassportStatic;
  loginRateLimiter: RequestHandler;
  validateLogin: RequestHandler;
  verifyPasswordRateLimiter: RequestHandler;
  parseVerifyPassword: (input: unknown) => SafeParseReturnType<unknown, VerifyPasswordBody>;
  parseChangePassword: (input: unknown) => SafeParseReturnType<unknown, ChangePasswordBody>;
  getUserPasswordHash: (userId: string) => Promise<string | null>;
  comparePassword: (plain: string, hash: string) => Promise<boolean>;
  hashPassword: (plain: string) => Promise<string>;
  updateUserPassword: (userId: string, hash: string) => Promise<void>;
}

export function registerAuthPasswordRoutes(
  app: Express,
  deps: RegisterAuthPasswordRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('auth-service');
  const {
    passport,
    loginRateLimiter,
    validateLogin,
    verifyPasswordRateLimiter,
    parseVerifyPassword,
    parseChangePassword,
    getUserPasswordHash,
    comparePassword,
    hashPassword,
    updateUserPassword,
  } = deps;

  app.post('/api/auth/login', loginRateLimiter, validateLogin, passport.authenticate('local'), (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Falha na autenticação' });
    }
    return res.json({ user: req.user });
  });

  app.post('/api/auth/verify-password', requireAuth(), verifyPasswordRateLimiter, async (req: Request, res: Response) => {
    const parsed = parseVerifyPassword(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Senha inválida', details: parsed.error.flatten() });
    }
    try {
      const auth = req.user as AuthContext;
      const passwordHash = await getUserPasswordHash(auth.userId);
      if (!passwordHash) {
        return res.status(400).json({ error: 'Usuário não possui senha local cadastrada.' });
      }
      const valid = await comparePassword(parsed.data.password, passwordHash);
      if (!valid) {
        return res.status(401).json({ error: 'Senha incorreta' });
      }
      const actionRequestId = typeof parsed.data.actionContext?.actionRequestId === 'string'
        ? parsed.data.actionContext.actionRequestId
        : null;
      writeApprovalStepUpSession(req, {
        method: 'password',
        actionRequestId,
      });
      return res.json({ verified: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: message }, 'Falha ao validar senha');
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/auth/change-password', requireAuth(), verifyPasswordRateLimiter, async (req: Request, res: Response) => {
    const parsed = parseChangePassword(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    try {
      const auth = req.user as AuthContext;
      const passwordHash = await getUserPasswordHash(auth.userId);
      if (!passwordHash) {
        return res.status(400).json({ error: 'Usuário não possui senha local cadastrada.' });
      }
      const valid = await comparePassword(parsed.data.currentPassword, passwordHash);
      if (!valid) {
        return res.status(401).json({ error: 'Senha atual incorreta' });
      }
      if (parsed.data.currentPassword === parsed.data.newPassword) {
        return res.status(400).json({ error: 'A nova senha deve ser diferente da atual.' });
      }
      const newHash = await hashPassword(parsed.data.newPassword);
      await updateUserPassword(auth.userId, newHash);
      return res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: message }, 'Falha ao alterar senha');
      return res.status(500).json({ error: message });
    }
  });
}
