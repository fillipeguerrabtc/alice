import type { Express, Request, Response } from 'express';
import { getDatabase, schema } from '@alice/database';
import { createLogger } from '@alice/logger';
import { extractAuthContext, requirePermission } from '@alice/shared-utils';
import { z } from 'zod';

interface SendWhatsAppResult {
  success: boolean;
  messageSid?: string;
  error?: string;
}

interface RegisterTwilioOperationalRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioWhatsappNumber?: string;
  sendWhatsAppMessage: (to: string, message: string, mediaUrl?: string) => Promise<SendWhatsAppResult>;
}

const twilioPhoneRegex = /^(whatsapp:)?\+?[1-9]\d{9,14}$/;
const twilioSendSchema = z.object({
  to: z.string().min(10).max(30).regex(twilioPhoneRegex),
  message: z.string().min(1).max(1600),
  conversationId: z.string().uuid().optional(),
  mediaUrl: z.string().url().optional(),
});

export function registerTwilioOperationalRoutes(
  app: Express,
  deps: RegisterTwilioOperationalRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.post('/api/integrations/twilio/send', requirePermission('integrations:twilio:write'), async (req: Request, res: Response) => {
    const parseResult = twilioSendSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Input inválido' });
    }
    const { to, message, conversationId, mediaUrl } = parseResult.data;

    try {
      const result = await deps.sendWhatsAppMessage(to, message, mediaUrl);
      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      if (conversationId) {
        const db = getDatabase();
        const authContext = extractAuthContext(req);
        await db.insert(schema.messages).values({
          conversationId,
          userId: authContext?.userId,
          isFromUser: false,
          conteudo: message,
          tipo: mediaUrl ? 'mixed' : 'text',
          metadata: {
            channel: 'whatsapp',
            twilioMessageSid: result.messageSid,
            sentByAgent: true,
            mediaUrl,
          },
        });
      }

      res.json({ success: true, messageSid: result.messageSid });
    } catch (error) {
      logger.error({ error, to }, 'Falha ao enviar mensagem WhatsApp');
      res.status(500).json({ error: 'Falha ao enviar mensagem' });
    }
  });

  app.get('/api/integrations/twilio/status', requirePermission('integrations:twilio:read'), (_req: Request, res: Response) => {
    const configured = !!(deps.twilioAccountSid && deps.twilioAuthToken && deps.twilioWhatsappNumber);
    res.json({
      configured,
      accountSid: deps.twilioAccountSid ? `***${deps.twilioAccountSid.slice(-4)}` : null,
      whatsappNumber: deps.twilioWhatsappNumber ? deps.twilioWhatsappNumber.slice(-4) : null,
    });
  });
}
