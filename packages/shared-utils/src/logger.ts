/**
 * Logger Centralizado - Alice Enterprise Platform
 * 
 * Re-exporta o logger do pacote @alice/logger para manter
 * compatibilidade com imports existentes de @alice/shared-utils.
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

// Importar do pacote @alice/logger (fonte única de verdade)
import {
  createLogger as _createLogger,
  createChildLogger as _createChildLogger,
  logger,
  getLogContext,
  runWithLogContext,
  setLogContext,
  type Logger,
  type LogContext,
} from '@alice/logger';

// Re-exportar para manter compatibilidade com imports existentes
export {
  _createLogger as createLogger,
  _createChildLogger as createChildLogger,
  logger as defaultLogger,
  getLogContext,
  runWithLogContext,
  setLogContext,
  type Logger,
  type LogContext,
};

// Alias para compatibilidade
export type LoggerContext = import('@alice/logger').LogContext;

/**
 * Interface para configuração do logger (compatibilidade)
 */
export interface LoggerConfig {
  /** Nível de log (debug, info, warn, error). Default: process.env.LOG_LEVEL ou 'info' */
  level?: string;
  /** Contexto adicional para incluir em todos os logs deste logger */
  additionalContext?: Record<string, unknown>;
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
 * Obtém o logger base singleton (para casos especiais)
 * Uso: diagnóstico, testes, shutdown handlers
 */
export function getBaseSingletonLogger(): Logger {
  return _createLogger('alice-platform');
}
