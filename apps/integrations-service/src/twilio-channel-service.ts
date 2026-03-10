import crypto from 'node:crypto';
import { createLogger } from '@alice/logger';

type ObserveIntegrationCallFn = <T>(args: {
  integration: string;
  operation: string;
  fn: () => Promise<T>;
}) => Promise<T>;

interface BuildValidateTwilioSignatureDeps {
  logger?: ReturnType<typeof createLogger>;
  twilioAuthToken?: string;
  isProduction: boolean;
}

interface BuildSendWhatsAppMessageDeps {
  logger?: ReturnType<typeof createLogger>;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioWhatsappNumber?: string;
  externalApiTimeoutMs: number;
  observeIntegrationCall: ObserveIntegrationCallFn;
}

export function buildValidateTwilioSignature(
  deps: BuildValidateTwilioSignatureDeps,
): (
  signature: string,
  url: string,
  params: Record<string, string>,
) => { valid: boolean; reason?: string } {
  const logger = deps.logger ?? createLogger('integrations-service');
  const { twilioAuthToken } = deps;

  return (signature: string, url: string, params: Record<string, string>): { valid: boolean; reason?: string } => {
    if (!twilioAuthToken) {
      if (deps.isProduction) {
        logger.error('TWILIO_AUTH_TOKEN obrigatório em produção - webhook rejeitado');
        return { valid: false, reason: 'AUTH_TOKEN_MISSING' };
      }
      logger.warn('TWILIO_AUTH_TOKEN não configurado - validação ignorada em desenvolvimento');
      return { valid: true, reason: 'DEV_MODE_SKIP' };
    }

    if (!signature) {
      logger.warn('X-Twilio-Signature header ausente');
      return { valid: false, reason: 'SIGNATURE_MISSING' };
    }

    try {
      const sortedParams = Object.keys(params)
        .sort()
        .reduce((acc, key) => acc + key + (params[key] || ''), '');
      const dataToSign = url + sortedParams;

      const expectedSignature = crypto
        .createHmac('sha1', twilioAuthToken)
        .update(new Uint8Array(Buffer.from(dataToSign, 'utf-8')))
        .digest('base64');

      const signatureBuffer = new Uint8Array(Buffer.from(signature));
      const expectedBuffer = new Uint8Array(Buffer.from(expectedSignature));

      if (signatureBuffer.length !== expectedBuffer.length) {
        return { valid: false, reason: 'SIGNATURE_LENGTH_MISMATCH' };
      }

      const isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
      return { valid: isValid, reason: isValid ? 'VALID' : 'SIGNATURE_MISMATCH' };
    } catch (error) {
      logger.error({ error }, 'Erro ao validar assinatura Twilio');
      return { valid: false, reason: 'VALIDATION_ERROR' };
    }
  };
}

export function buildSendWhatsAppMessage(
  deps: BuildSendWhatsAppMessageDeps,
): (to: string, body: string, mediaUrl?: string) => Promise<{
  success: boolean;
  messageSid?: string;
  error?: string;
}> {
  const logger = deps.logger ?? createLogger('integrations-service');

  return async (
    to: string,
    body: string,
    mediaUrl?: string,
  ): Promise<{ success: boolean; messageSid?: string; error?: string }> => {
    const {
      twilioAccountSid,
      twilioAuthToken,
      twilioWhatsappNumber,
      externalApiTimeoutMs,
      observeIntegrationCall,
    } = deps;

    if (!twilioAccountSid || !twilioAuthToken || !twilioWhatsappNumber) {
      logger.error('Twilio não configurado para envio de mensagens');
      return { success: false, error: 'Twilio não configurado' };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), externalApiTimeoutMs);

    try {
      const formData = new URLSearchParams();
      formData.append('From', `whatsapp:${twilioWhatsappNumber}`);
      formData.append('To', to.startsWith('whatsapp:') ? to : `whatsapp:${to}`);
      formData.append('Body', body);
      if (mediaUrl) {
        formData.append('MediaUrl', mediaUrl);
      }

      const response = await observeIntegrationCall({
        integration: 'twilio',
        operation: mediaUrl ? 'whatsapp_media' : 'whatsapp',
        fn: async () => {
          const result = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
            {
              method: 'POST',
              headers: {
                Authorization: `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: formData.toString(),
              signal: controller.signal,
            },
          );

          if (!result.ok) {
            const errorData = await result.json() as { message?: string };
            throw new Error(errorData.message || `Twilio API error: ${result.status}`);
          }
          return result;
        },
      });

      const data = await response.json() as { sid: string };
      logger.info({ messageSid: data.sid, to }, 'Mensagem WhatsApp enviada com sucesso');
      return { success: true, messageSid: data.sid };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error, to }, 'Falha ao enviar mensagem WhatsApp');
      return { success: false, error: errorMessage };
    } finally {
      clearTimeout(timeoutId);
    }
  };
}
