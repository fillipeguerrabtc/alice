import crypto from 'node:crypto';
import type { AuthContext, InternalAuthHeaders } from '@alice/shared-utils';

type TwilioWorkflowLogger = {
  info: (payload: unknown, message: string) => void;
  warn: (payload: unknown, message: string) => void;
  error: (payload: unknown, message: string) => void;
};

type GenerateInternalAuthHeadersFn = (params: AuthContext) => InternalAuthHeaders;

type BuildProcessMessageWithLlmOptions = {
  chatServiceUrl: string;
  logger: TwilioWorkflowLogger;
  generateInternalAuthHeaders: GenerateInternalAuthHeadersFn;
};

type BuildProcessWhatsAppMediaForRagOptions = {
  ragServiceUrl: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  logger: TwilioWorkflowLogger;
  generateInternalAuthHeaders: GenerateInternalAuthHeadersFn;
};

/**
 * Resultado do processamento de mensagem via Chat Service.
 */
export interface ChatMessageResult {
  response: string | null;
  escalated: boolean;
  humanMode: boolean;
  trigger?: string;
  error?: string;
}

const LLM_PROCESS_TIMEOUT_MS = 30000;
const WHATSAPP_MEDIA_PROCESS_TIMEOUT_MS = 60000;

/**
 * Cria handler de processamento de mensagens via Chat Service (LLM + RAG).
 */
export function buildProcessMessageWithLLM({
  chatServiceUrl,
  logger,
  generateInternalAuthHeaders,
}: BuildProcessMessageWithLlmOptions) {
  return async function processMessageWithLLM(
    conversationId: string,
    message: string,
    tenantId?: string
  ): Promise<ChatMessageResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_PROCESS_TIMEOUT_MS);

    try {
      const internalHeaders = generateInternalAuthHeaders({
        userId: 'integrations-service',
        tenantId,
        role: 'super_admin',
      });
      const correlationId = crypto.randomUUID();
      const idempotencyKey = crypto
        .createHash('sha256')
        .update(`chat-message:${conversationId}:${message}`)
        .digest('hex');

      const response = await fetch(`${chatServiceUrl}/api/chat/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-correlation-id': correlationId,
          'x-idempotency-key': idempotencyKey,
          ...internalHeaders,
        },
        body: JSON.stringify({
          conversationId,
          content: message,
          role: 'user',
          channel: 'whatsapp',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Chat service error: ${response.status}`);
      }

      const data = await response.json() as {
        response?: string;
        escalated?: boolean;
        humanMode?: boolean;
        trigger?: string;
      };

      if (data.escalated) {
        logger.info({
          conversationId,
          trigger: data.trigger,
          channel: 'whatsapp',
        }, 'Escalação automática detectada via WhatsApp');

        return {
          response: data.response || 'Um de nossos atendentes irá auxiliá-lo em breve. Por favor, aguarde.',
          escalated: true,
          humanMode: false,
          trigger: data.trigger,
        };
      }

      if (data.humanMode) {
        logger.info({
          conversationId,
          channel: 'whatsapp',
        }, 'Conversa em modo humano - mensagem encaminhada para agente');

        return {
          response: null,
          escalated: false,
          humanMode: true,
        };
      }

      return {
        response: data.response || '',
        escalated: false,
        humanMode: false,
      };
    } catch (error) {
      logger.error({ error, conversationId }, 'Falha ao processar mensagem com LLM');
      return {
        response: 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.',
        escalated: false,
        humanMode: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

/**
 * Cria handler de processamento de mídia do WhatsApp para indexação no RAG.
 */
export function buildProcessWhatsAppMediaForRAG({
  ragServiceUrl,
  twilioAccountSid,
  twilioAuthToken,
  logger,
  generateInternalAuthHeaders,
}: BuildProcessWhatsAppMediaForRagOptions) {
  return async function processWhatsAppMediaForRAG(
    mediaUrl: string,
    mediaContentType: string,
    conversationId: string,
    tenantId: string,
    userId: string
  ): Promise<{ success: boolean; uploadId?: string; error?: string }> {
    const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
    const SUPPORTED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'] as const;
    const normalizedContentType = mediaContentType.toLowerCase().trim().split(';')[0].trim();
    const isImage = SUPPORTED_IMAGE_TYPES.includes(normalizedContentType as typeof SUPPORTED_IMAGE_TYPES[number]);
    const isAudio = SUPPORTED_AUDIO_TYPES.includes(normalizedContentType as typeof SUPPORTED_AUDIO_TYPES[number]);

    if (!isImage && !isAudio) {
      logger.warn({
        mediaContentType: normalizedContentType,
        originalContentType: mediaContentType,
        conversationId,
        supportedTypes: {
          image: SUPPORTED_IMAGE_TYPES,
          audio: SUPPORTED_AUDIO_TYPES,
        },
      }, 'Tipo de mídia WhatsApp não suportado para RAG - apenas imagem e áudio são aceitos');
      return {
        success: false,
        error: `Tipo de mídia não suportado: ${mediaContentType}. Tipos suportados: imagens (${SUPPORTED_IMAGE_TYPES.join(', ')}) e áudio (${SUPPORTED_AUDIO_TYPES.join(', ')}).`,
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WHATSAPP_MEDIA_PROCESS_TIMEOUT_MS);

    try {
      const twilioAuthHeader = Buffer.from(
        `${twilioAccountSid}:${twilioAuthToken}`
      ).toString('base64');

      const mediaResponse = await fetch(mediaUrl, {
        headers: {
          Authorization: `Basic ${twilioAuthHeader}`,
        },
        signal: controller.signal,
      });

      if (!mediaResponse.ok) {
        throw new Error(`Falha ao baixar mídia do Twilio: ${mediaResponse.status}`);
      }

      const mediaBuffer = Buffer.from(await mediaResponse.arrayBuffer());
      const mediaBase64 = mediaBuffer.toString('base64');

      const extensionMap: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'audio/ogg': 'ogg',
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/wav': 'wav',
        'audio/webm': 'webm',
      };
      const extension = extensionMap[normalizedContentType] || 'bin';
      const mediaType = isImage ? 'image' : 'audio';

      const internalHeaders = generateInternalAuthHeaders({
        userId,
        tenantId,
        role: 'operator',
      });

      const ragResponse = await fetch(`${ragServiceUrl}/api/media/upload/json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Signature': internalHeaders['x-internal-signature'],
          'X-Internal-Timestamp': internalHeaders['x-internal-timestamp'],
          'X-Tenant-Id': tenantId,
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          file: mediaBase64,
          filename: `whatsapp_${Date.now()}.${extension}`,
          mimeType: mediaContentType,
          description: `Mídia recebida via WhatsApp na conversa ${conversationId}`,
          conversationId,
        }),
        signal: controller.signal,
      });

      if (!ragResponse.ok) {
        const errorText = await ragResponse.text();
        throw new Error(`Falha ao enviar mídia para RAG: ${ragResponse.status} - ${errorText}`);
      }

      const ragData = await ragResponse.json() as { id?: string; uploadId?: string };
      const uploadId = ragData.id || ragData.uploadId;

      logger.info({
        uploadId,
        mediaType,
        conversationId,
        tenantId,
        sizeBytes: mediaBuffer.length,
      }, 'Mídia WhatsApp indexada no RAG com sucesso');

      return { success: true, uploadId };
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        mediaUrl,
        conversationId,
        tenantId,
      }, 'Erro ao processar mídia WhatsApp para RAG');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  };
}
