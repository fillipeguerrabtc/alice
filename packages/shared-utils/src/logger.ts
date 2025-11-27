/**
 * Logger Centralizado - Alice Enterprise Platform
 * 
 * Usa Pino para logging estruturado (Regra 8 - console.log é PROIBIDO).
 * Mensagens em Português Brasileiro (Regra 10 - Documentação PT-BR).
 * 
 * @module @alice/shared-utils/logger
 */

import pino, { Logger, LoggerOptions } from 'pino';

/**
 * Interface para metadados de contexto do logger
 */
export interface LoggerContext {
  service: string;
  tenantId?: string;
  userId?: string;
  requestId?: string;
  [key: string]: unknown;
}

/**
 * Opções de configuração do logger
 */
export interface LoggerConfig {
  level?: string;
  prettyPrint?: boolean;
  additionalContext?: Record<string, unknown>;
}

/**
 * Cria uma instância de logger Pino configurada para produção enterprise
 * 
 * @param service - Nome do serviço (ex: 'chat-service', 'rag-service')
 * @param config - Configurações opcionais do logger
 * @returns Logger Pino configurado
 * 
 * @example
 * ```typescript
 * import { createLogger } from '@alice/shared-utils/logger';
 * 
 * const logger = createLogger('chat-service');
 * logger.info({ conversationId: '123' }, 'Conversa criada com sucesso');
 * ```
 */
export function createLogger(service: string, config?: LoggerConfig): Logger {
  const isProd = process.env.NODE_ENV === 'production';
  const level = config?.level || process.env.LOG_LEVEL || 'info';
  const prettyPrint = config?.prettyPrint ?? !isProd;

  const options: LoggerOptions = {
    level,
    base: {
      service,
      env: process.env.NODE_ENV || 'development',
      ...config?.additionalContext,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (prettyPrint) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }

  return pino(options);
}

/**
 * Cria um logger filho com contexto adicional
 * 
 * @param parentLogger - Logger pai
 * @param context - Contexto adicional (tenantId, userId, etc.)
 * @returns Logger filho com contexto
 * 
 * @example
 * ```typescript
 * const requestLogger = createChildLogger(logger, { 
 *   tenantId: 'tenant-123', 
 *   userId: 'user-456' 
 * });
 * ```
 */
export function createChildLogger(
  parentLogger: Logger,
  context: Partial<LoggerContext>
): Logger {
  return parentLogger.child(context);
}

/**
 * Formata erro para logging estruturado
 * 
 * @param error - Erro a ser formatado
 * @returns Objeto formatado para log
 */
export function formatError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    };
  }
  
  return {
    errorMessage: String(error),
  };
}

/**
 * Logger padrão para uso em testes e desenvolvimento
 */
export const defaultLogger = createLogger('alice-platform');

export type { Logger };
