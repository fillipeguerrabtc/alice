import type { Express, Request, Response } from 'express';
import { getDatabase, schema } from '@alice/database';
import { createLogger } from '@alice/logger';
import { desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

interface ChatMessageResult {
  response: string | null;
  escalated: boolean;
  humanMode: boolean;
  trigger?: string;
}

interface SendWhatsAppResult {
  success: boolean;
  messageSid?: string;
  error?: string;
}

interface RegisterTwilioWebhookRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  twilioAuthToken?: string;
  chatServiceUrl: string;
  trainingServiceUrl: string;
  validateTwilioSignature: (
    signature: string,
    url: string,
    params: Record<string, string>,
  ) => { valid: boolean; reason?: string };
  generateInternalAuthHeaders: (params: {
    userId: string;
    tenantId?: string;
    role: 'super_admin' | 'admin' | 'manager' | 'operator' | 'viewer' | 'guest';
  }) => {
    'x-internal-signature': string;
    'x-internal-timestamp': string;
    'x-internal-user-id': string;
    'x-internal-role': string;
    'x-internal-tenant-id'?: string;
  };
  processMessageWithLLM: (
    conversationId: string,
    message: string,
    tenantId?: string,
  ) => Promise<ChatMessageResult>;
  sendWhatsAppMessage: (
    to: string,
    body: string,
    mediaUrl?: string,
  ) => Promise<SendWhatsAppResult>;
  processWhatsAppMediaForRAG: (
    mediaUrl: string,
    mediaContentType: string,
    conversationId: string,
    tenantId: string,
    userId: string,
  ) => Promise<{ success: boolean; uploadId?: string; error?: string }>;
}

const twilioPhoneRegex = /^(whatsapp:)?\+?[1-9]\d{9,14}$/;
const twilioIncomingSidRegex = /^(SM|MM)[0-9a-fA-F]{32}$/;
const twilioWebhookSchema = z.object({
  MessageSid: z.string().regex(twilioIncomingSidRegex),
  From: z.string().min(10).max(30).regex(twilioPhoneRegex),
  To: z.string().min(10).max(30).regex(twilioPhoneRegex),
  Body: z.string().max(1600).default(''),
  NumMedia: z.string().regex(/^\d+$/).optional(),
  MediaUrl0: z.string().url().optional(),
  MediaContentType0: z.string().max(100).optional(),
});

const twilioMessageStatuses = [
  'accepted', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed',
  'receiving', 'received',
  'scheduled', 'canceled',
  'read',
] as const;

const twilioSidRegex = /^SM[0-9a-fA-F]{32}$/;
const twilioStatusSchema = z.object({
  MessageSid: z.string().regex(twilioSidRegex),
  MessageStatus: z.enum(twilioMessageStatuses),
  ErrorCode: z.string().max(10).optional(),
  ErrorMessage: z.string().max(500).optional(),
  To: z.string().min(10).max(30).regex(twilioPhoneRegex),
});

export function registerTwilioWebhookRoutes(
  app: Express,
  deps: RegisterTwilioWebhookRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.post('/api/integrations/twilio/webhook/whatsapp', async (req: Request, res: Response) => {
    const twilioSignature = req.headers['x-twilio-signature'] as string;
    const webhookUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    const contentTypeHeader = req.headers['content-type'];
    const contentType = Array.isArray(contentTypeHeader)
      ? contentTypeHeader[0]?.toLowerCase()
      : contentTypeHeader?.toLowerCase();
    if (!contentType || !contentType.startsWith('application/x-www-form-urlencoded')) {
      logger.warn({ contentType }, 'Webhook Twilio: content-type inválido');
      return res.status(400).send('Invalid content-type');
    }

    if (!deps.twilioAuthToken) {
      logger.error('Webhook Twilio: TWILIO_AUTH_TOKEN não configurado');
      return res.status(500).send('Webhook secret not configured');
    }

    if (Buffer.isBuffer(req.body)) {
      logger.error('Webhook Twilio: body é Buffer mas deveria ser objeto (middleware incorreto - use express.urlencoded(), não express.raw())');
      return res.status(500).send('Invalid middleware configuration');
    }
    if (typeof req.body !== 'object' || req.body === null) {
      logger.error('Webhook Twilio: body inválido (deve ser objeto parseado por urlencoded)');
      return res.status(500).send('Invalid body format');
    }

    const validation = deps.validateTwilioSignature(
      twilioSignature,
      webhookUrl,
      req.body as Record<string, string>,
    );

    if (!validation.valid) {
      logger.warn({ webhookUrl, reason: validation.reason }, 'Assinatura Twilio inválida - webhook rejeitado');
      res.status(403).send('Forbidden');
      return;
    }

    res.set('Content-Type', 'text/xml');
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

    try {
      const parseResult = twilioWebhookSchema.safeParse(req.body);
      if (!parseResult.success) {
        logger.warn({ errors: parseResult.error.flatten() }, 'Payload Twilio inválido');
        return;
      }
      const {
        MessageSid,
        From,
        To,
        Body,
        NumMedia,
        MediaUrl0,
        MediaContentType0,
      } = parseResult.data;

      logger.info({
        messageSid: MessageSid,
        from: From,
        hasMedia: parseInt(NumMedia || '0', 10) > 0,
      }, 'Webhook WhatsApp recebido');

      const db = getDatabase();
      const phoneNumber = From.replace('whatsapp:', '');

      let user = await db.query.users.findFirst({
        where: eq(schema.users.telefone, phoneNumber),
      });

      if (!user) {
        const [newUser] = await db.insert(schema.users).values({
          email: `whatsapp_${phoneNumber.replace(/\+/g, '')}@temp.alice.app`,
          telefone: phoneNumber,
          firstName: 'WhatsApp',
          lastName: `User ${phoneNumber.slice(-4)}`,
          authProvider: 'whatsapp',
          role: 'guest',
        }).returning();
        user = newUser;
        logger.info({ userId: user.id, phone: phoneNumber }, 'Novo usuário WhatsApp criado');
      }

      let conversation = await db.query.conversations.findFirst({
        where: (c, { and, eq: eqOperator }) => and(
          eqOperator(c.userId, user.id),
          eqOperator(c.status, 'active'),
          eqOperator(c.metadata, sql`metadata->>'channel' = 'whatsapp'`),
        ),
        orderBy: [desc(schema.conversations.criadoEm)],
      });

      if (!conversation) {
        const [newConversation] = await db.insert(schema.conversations).values({
          userId: user.id,
          titulo: `WhatsApp - ${phoneNumber}`,
          status: 'active',
          metadata: {
            channel: 'whatsapp',
            phoneNumber,
            twilioFrom: From,
            twilioTo: To,
          },
        }).returning();
        conversation = newConversation;
        logger.info({ conversationId: conversation.id }, 'Nova conversa WhatsApp criada');
      }

      await db.insert(schema.messages).values({
        conversationId: conversation.id,
        userId: user.id,
        isFromUser: true,
        conteudo: Body,
        tipo: parseInt(NumMedia || '0', 10) > 0 ? 'mixed' : 'text',
        metadata: {
          twilioMessageSid: MessageSid,
          mediaUrl: MediaUrl0,
          mediaContentType: MediaContentType0,
          channel: 'whatsapp',
        },
      });

      if (MediaUrl0 && MediaContentType0 && user.tenantId) {
        deps.processWhatsAppMediaForRAG(
          MediaUrl0,
          MediaContentType0,
          conversation.id,
          user.tenantId,
          user.id,
        ).catch((error) => {
          logger.error({
            error: error instanceof Error ? error.message : String(error),
            mediaUrl: MediaUrl0,
            conversationId: conversation.id,
          }, 'Erro ao processar mídia WhatsApp para RAG (não crítico)');
        });
      }

      const conversationState = await db.query.conversationStates.findFirst({
        where: eq(schema.conversationStates.conversationId, conversation.id),
      });

      if (conversationState?.controlMode === 'human') {
        logger.info({
          conversationId: conversation.id,
          controlMode: 'human',
        }, 'Conversa em modo humano - mensagem salva sem resposta automática');

        const notifyController = new AbortController();
        const notifyTimeoutId = setTimeout(() => notifyController.abort(), 5000);
        try {
          const internalHeaders = deps.generateInternalAuthHeaders({
            userId: 'integrations-service',
            tenantId: user.tenantId ?? undefined,
            role: 'super_admin',
          });
          await fetch(`${deps.chatServiceUrl}/api/chat/notify-agent`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-correlation-id': randomUUID(),
              ...internalHeaders,
            },
            body: JSON.stringify({
              conversationId: conversation.id,
              type: 'new_message',
              message: Body,
              from: phoneNumber,
            }),
            signal: notifyController.signal,
          });
        } catch (notifyError) {
          logger.warn({ error: notifyError }, 'Falha ao notificar agente humano');
        } finally {
          clearTimeout(notifyTimeoutId);
        }
        return;
      }

      const chatResult = await deps.processMessageWithLLM(
        conversation.id,
        Body,
        user.tenantId ?? undefined,
      );

      if (chatResult.humanMode) {
        logger.info({
          conversationId: conversation.id,
          channel: 'whatsapp',
        }, 'Conversa em modo humano - aguardando resposta do agente');
        return;
      }

      if (chatResult.escalated) {
        logger.info({
          conversationId: conversation.id,
          trigger: chatResult.trigger,
          channel: 'whatsapp',
        }, 'Escalação automática processada via WhatsApp');

        await db.insert(schema.messages).values({
          conversationId: conversation.id,
          isFromUser: false,
          conteudo: chatResult.response || 'Um de nossos atendentes irá auxiliá-lo em breve.',
          tipo: 'text',
          metadata: {
            channel: 'whatsapp',
            escalated: true,
            escalationTrigger: chatResult.trigger,
          },
        });

        const escalationMessage = chatResult.response || 'Um de nossos atendentes irá auxiliá-lo em breve. Por favor, aguarde.';
        const sendResult = await deps.sendWhatsAppMessage(From, escalationMessage);

        if (!sendResult.success) {
          logger.error({
            conversationId: conversation.id,
            error: sendResult.error,
          }, 'Falha ao enviar notificação de escalação WhatsApp');
        }

        return;
      }

      if (chatResult.response) {
        await db.insert(schema.messages).values({
          conversationId: conversation.id,
          isFromUser: false,
          conteudo: chatResult.response,
          tipo: 'text',
          metadata: {
            channel: 'whatsapp',
            generatedBy: 'llm',
          },
        });

        const sendResult = await deps.sendWhatsAppMessage(From, chatResult.response);
        if (!sendResult.success) {
          logger.error({
            conversationId: conversation.id,
            error: sendResult.error,
          }, 'Falha ao enviar resposta WhatsApp');
        }

        try {
          const rating = chatResult.escalated ? 1 : 5;
          const hasValidResponse = chatResult.response.trim().length > 0;

          if (!conversation.sentToTrainingAt && (rating >= 4 || chatResult.escalated) && hasValidResponse) {
            const namespaceId = conversation.namespaceId || undefined;
            const tenantId = user.tenantId;

            if (tenantId) {
              const internalHeaders = deps.generateInternalAuthHeaders({
                userId: user.id,
                tenantId,
                role: 'super_admin',
              });

              const trainingController = new AbortController();
              const trainingTimeoutId = setTimeout(() => trainingController.abort(), 10000);

              try {
                const trainingResponse = await fetch(`${deps.trainingServiceUrl}/api/training/data`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Internal-Signature': internalHeaders['x-internal-signature'],
                    'X-Internal-Timestamp': internalHeaders['x-internal-timestamp'],
                    'X-Internal-User-Id': user.id,
                    'X-Internal-Tenant-Id': tenantId,
                    'X-Internal-Role': 'super_admin',
                  },
                  body: JSON.stringify({
                    tenantId,
                    namespaceId: namespaceId || undefined,
                    conversationId: conversation.id,
                    source: 'whatsapp',
                    messages: [
                      { role: 'user', content: Body },
                      { role: 'assistant', content: chatResult.response },
                    ],
                    rating,
                  }),
                  signal: trainingController.signal,
                });

                if (!trainingResponse.ok) {
                  const errorText = await trainingResponse.text();
                  logger.error({
                    conversationId: conversation.id,
                    status: trainingResponse.status,
                    error: errorText,
                  }, 'Falha ao coletar dados de treinamento do WhatsApp');
                } else {
                  const trainingData = await trainingResponse.json() as { trainingData?: { id: string }; isDuplicate?: boolean };
                  logger.info({
                    conversationId: conversation.id,
                    trainingDataId: trainingData.trainingData?.id,
                    isDuplicate: trainingData.isDuplicate,
                    rating,
                    source: 'whatsapp',
                  }, 'Dados de treinamento do WhatsApp coletados com sucesso');
                  await getDatabase()
                    .update(schema.conversations)
                    .set({ sentToTrainingAt: new Date(), atualizadoEm: new Date() })
                    .where(eq(schema.conversations.id, conversation.id));
                }
              } finally {
                clearTimeout(trainingTimeoutId);
              }
            }
          }
        } catch (trainingError) {
          logger.error({ error: trainingError, conversationId: conversation.id }, 'Erro ao coletar dados de treinamento do WhatsApp (não crítico)');
        }
      }
    } catch (error) {
      logger.error({ error }, 'Erro ao processar webhook WhatsApp');
    }
  });

  app.post('/api/integrations/twilio/webhook/status', async (req: Request, res: Response) => {
    const twilioSignature = req.headers['x-twilio-signature'] as string;
    const webhookUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    const contentTypeHeader = req.headers['content-type'];
    const contentType = Array.isArray(contentTypeHeader)
      ? contentTypeHeader[0]?.toLowerCase()
      : contentTypeHeader?.toLowerCase();
    if (!contentType || !contentType.startsWith('application/x-www-form-urlencoded')) {
      logger.warn({ contentType }, 'Webhook Twilio status: content-type inválido');
      return res.status(400).send('Invalid content-type');
    }

    if (!deps.twilioAuthToken) {
      logger.error('Webhook Twilio: TWILIO_AUTH_TOKEN não configurado');
      return res.status(500).send('Webhook secret not configured');
    }

    if (Buffer.isBuffer(req.body) || typeof req.body !== 'object' || req.body === null) {
      logger.error('Webhook Twilio status: body inválido (deve ser objeto parseado por urlencoded, não Buffer)');
      return res.status(500).send('Invalid body format');
    }

    const validation = deps.validateTwilioSignature(
      twilioSignature,
      webhookUrl,
      req.body as Record<string, string>,
    );

    if (!validation.valid) {
      logger.warn({ webhookUrl, reason: validation.reason }, 'Assinatura Twilio inválida - status webhook rejeitado');
      res.status(403).send('Forbidden');
      return;
    }

    res.set('Content-Type', 'text/xml');
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

    try {
      const parseResult = twilioStatusSchema.safeParse(req.body);
      if (!parseResult.success) {
        logger.warn({ errors: parseResult.error.flatten() }, 'Payload status Twilio inválido');
        return;
      }
      const {
        MessageSid,
        MessageStatus,
        ErrorCode,
        ErrorMessage,
        To,
      } = parseResult.data;

      logger.info({
        messageSid: MessageSid,
        status: MessageStatus,
        errorCode: ErrorCode,
        to: To,
      }, 'Status de mensagem Twilio recebido');

      if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
        logger.error({
          messageSid: MessageSid,
          status: MessageStatus,
          errorCode: ErrorCode,
          errorMessage: ErrorMessage,
        }, 'Mensagem WhatsApp falhou na entrega');

        const db = getDatabase();
        await db.insert(schema.auditLogs).values({
          acao: 'whatsapp_delivery_failed',
          recurso: 'message',
          detalhes: {
            messageSid: MessageSid,
            status: MessageStatus,
            errorCode: ErrorCode,
            errorMessage: ErrorMessage,
            to: To,
          },
        });
      }
    } catch (error) {
      logger.error({ error }, 'Erro ao processar webhook de status Twilio');
    }
  });
}
