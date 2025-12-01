/**
 * Logger Centralizado - Alice Enterprise Platform
 * 
 * Usa Pino para logging estruturado (Regra 8 - console.log é PROIBIDO).
 * Mensagens em Português Brasileiro (Regra 10 - Documentação PT-BR).
 * 
 * ARQUITETURA SINGLETON (Enterprise-Grade):
 * - Um único logger base é criado com transport pino-pretty
 * - Todos os serviços usam child loggers do singleton base
 * - Isso evita múltiplos listeners de process.on('exit') do pino-pretty
 * - Child loggers compartilham o mesmo transport (zero overhead)
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
 * 
 * Formato de output controlado por variáveis de ambiente:
 * - LOG_FORMAT=json → Força JSON (útil para testes e CI)
 * - LOG_FORMAT=pretty → Força pretty-print colorizado
 * - Default: NODE_ENV=production → JSON, outros → Pretty-print
 */
export interface LoggerConfig {
  /** Nível de log (debug, info, warn, error). Default: process.env.LOG_LEVEL ou 'info' */
  level?: string;
  /** Contexto adicional para incluir em todos os logs deste logger */
  additionalContext?: Record<string, unknown>;
}

// ============================================================================
// SINGLETON BASE LOGGER (Enterprise-Grade - Elimina duplicação de listeners)
// ============================================================================

let baseLoggerInstance: Logger | null = null;
let baseLoggerInitialized = false;

/**
 * Determina se deve usar pretty-print baseado nas variáveis de ambiente
 * 
 * Prioridade:
 * 1. LOG_FORMAT=json → false (força JSON)
 * 2. LOG_FORMAT=pretty → true (força pretty)
 * 3. NODE_ENV=production → false (JSON para prod)
 * 4. Default → true (pretty para desenvolvimento)
 */
function shouldUsePrettyPrint(): boolean {
  const logFormat = process.env.LOG_FORMAT?.toLowerCase();
  
  if (logFormat === 'json') {
    return false;
  }
  if (logFormat === 'pretty') {
    return true;
  }
  
  // Default: JSON em produção, pretty em desenvolvimento
  return process.env.NODE_ENV !== 'production';
}

/**
 * Obtém ou cria o logger base singleton
 * 
 * Este logger é criado apenas UMA vez por processo, garantindo:
 * - Um único transport pino-pretty (ou JSON se configurado)
 * - Um único listener de process.on('exit')
 * - Zero overhead para child loggers
 */
function getBaseLogger(): Logger {
  if (baseLoggerInstance && baseLoggerInitialized) {
    return baseLoggerInstance;
  }

  const level = process.env.LOG_LEVEL || 'info';
  const usePrettyPrint = shouldUsePrettyPrint();

  const options: LoggerOptions = {
    level,
    base: {
      env: process.env.NODE_ENV || 'development',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (usePrettyPrint) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }

  baseLoggerInstance = pino(options);
  baseLoggerInitialized = true;
  
  return baseLoggerInstance;
}

/**
 * Cria um child logger do singleton base para um serviço específico
 * 
 * Esta função é a forma recomendada de obter um logger.
 * Internamente, cria um child logger do singleton base, garantindo:
 * - Compartilhamento do mesmo transport (sem novos listeners)
 * - Contexto de serviço isolado
 * - Performance enterprise-grade
 * 
 * @param service - Nome do serviço (ex: 'chat-service', 'rag-service')
 * @param config - Configurações opcionais do logger
 * @returns Logger Pino child configurado
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
  const baseLogger = getBaseLogger();
  
  // Criar child logger com contexto do serviço
  const childLogger = baseLogger.child({
    service,
    ...config?.additionalContext,
  });
  
  // Se level específico foi passado, criar novo child com level customizado
  if (config?.level && config.level !== baseLogger.level) {
    return childLogger.child({}, { level: config.level });
  }
  
  return childLogger;
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
 * Usa o singleton base diretamente
 */
export const defaultLogger = createLogger('alice-platform');

/**
 * Obtém o logger base singleton (para casos especiais)
 * Uso: diagnóstico, testes, shutdown handlers
 */
export function getBaseSingletonLogger(): Logger {
  return getBaseLogger();
}

export type { Logger };
