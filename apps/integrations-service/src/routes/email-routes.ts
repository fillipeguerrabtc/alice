import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import { z } from 'zod';

interface EmailTransporterLike {
  sendMail(payload: {
    from?: string;
    to: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
  }): Promise<{
    messageId: string;
    accepted: unknown;
    rejected: unknown;
  }>;
  verify(callback: (err: Error | null, success: boolean) => void): void;
}

type ObserveIntegrationCallFn = <T>(args: {
  integration: string;
  operation: string;
  fn: () => Promise<T>;
}) => Promise<T>;

interface RegisterEmailRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  emailTransporter: EmailTransporterLike | null;
  gmailUser?: string;
  observeIntegrationCall: ObserveIntegrationCallFn;
}

const emailSchema = z.object({
  to: z.union([
    z.string().trim().email(),
    z.array(z.string().trim().email()).min(1).max(50),
  ]),
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(100000),
  text: z.string().optional(),
  from: z.string().trim().email().optional(),
  replyTo: z.string().trim().email().optional(),
  metadata: z.object({
    type: z.enum(['receipt', 'invoice', 'promotion', 'notification', 'alert', 'other']).optional(),
    orderId: z.string().optional(),
    customerId: z.string().optional(),
    tenantId: z.string().uuid().optional(),
  }).optional(),
});

export function registerEmailRoutes(
  app: Express,
  deps: RegisterEmailRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const { emailTransporter, gmailUser, observeIntegrationCall } = deps;

  app.post('/api/integrations/email/send', requirePermission('integrations:email:write'), async (req: Request, res: Response) => {
    const parsed = emailSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn({ errors: parsed.error.flatten() }, 'Payload inválido para email');
      return res.status(400).json({ error: 'Payload inválido', details: parsed.error.format() });
    }

    if (!emailTransporter) {
      logger.error('Gmail SMTP não configurado');
      return res.status(503).json({ error: 'Serviço de email não configurado' });
    }

    const { to, subject, html, text, from, replyTo, metadata } = parsed.data;
    const fromEmail = from ?? gmailUser;

    try {
      const result = await observeIntegrationCall({
        integration: 'email',
        operation: 'send',
        fn: () => emailTransporter.sendMail({
          from: fromEmail,
          to: Array.isArray(to) ? to.join(', ') : to,
          subject,
          html,
          text: text ?? undefined,
          replyTo: replyTo ?? undefined,
        }),
      });

      logger.info({
        messageId: result.messageId,
        to: Array.isArray(to) ? to.length : 1,
        subject,
        from: fromEmail,
        type: metadata?.type ?? 'other',
        orderId: metadata?.orderId,
      }, 'Email enviado via Gmail SMTP');

      res.json({
        success: true,
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected,
      });
    } catch (error) {
      logger.error({ error, to, subject }, 'Falha ao enviar email via Gmail SMTP');
      res.status(500).json({ error: 'Falha ao enviar email' });
    }
  });

  app.get('/api/integrations/email/health', requirePermission('integrations:email:read'), async (_req: Request, res: Response) => {
    if (!emailTransporter) {
      return res.status(503).json({
        status: 'unavailable',
        configured: false,
        message: 'Gmail SMTP não configurado',
      });
    }

    try {
      await new Promise<void>((resolve, reject) => {
        emailTransporter.verify((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
      res.json({
        status: 'healthy',
        configured: true,
        smtp: {
          host: 'smtp.gmail.com',
          port: 587,
          user: gmailUser,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Gmail SMTP health check falhou');
      res.status(503).json({
        status: 'unhealthy',
        configured: true,
        error: 'Falha na conexão SMTP',
      });
    }
  });
}
