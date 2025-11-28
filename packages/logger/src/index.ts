import pino, { Logger, LoggerOptions } from 'pino';
import { AsyncLocalStorage } from 'async_hooks';

const isDevelopment = process.env.NODE_ENV !== 'production';

// ============================================================================
// ASYNC LOCAL STORAGE PARA CONTEXTO DE REQUISIÇÃO
// ============================================================================

export interface LogContext {
  correlationId?: string;
  requestId?: string;
  tenantId?: string;
  userId?: string;
}

const logContextStorage = new AsyncLocalStorage<LogContext>();

/**
 * Obtém o contexto de log atual do AsyncLocalStorage
 */
export function getLogContext(): LogContext | undefined {
  return logContextStorage.getStore();
}

/**
 * Executa uma função dentro de um contexto de log
 */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return logContextStorage.run(context, fn);
}

/**
 * Define o contexto de log para a requisição atual
 * Usado pelo middleware de correlação
 */
export function setLogContext(context: LogContext): void {
  const store = logContextStorage.getStore();
  if (store) {
    Object.assign(store, context);
  }
}

// ============================================================================
// CONFIGURAÇÃO DO PINO LOGGER
// ============================================================================

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      host: bindings.hostname,
      service: process.env.SERVICE_NAME || 'alice',
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin: () => {
    const context = logContextStorage.getStore();
    if (context) {
      return {
        correlationId: context.correlationId,
        requestId: context.requestId,
        tenantId: context.tenantId,
        userId: context.userId,
      };
    }
    return {};
  },
};

const devOptions: LoggerOptions = {
  ...baseOptions,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
  mixin: baseOptions.mixin,
};

/**
 * Cria um logger Pino configurado para o serviço
 * 
 * - Em produção: JSON estruturado com correlation IDs
 * - Em desenvolvimento: pino-pretty com cores
 * 
 * O logger injeta automaticamente correlationId, requestId, tenantId e userId
 * do contexto AsyncLocalStorage quando disponível.
 * 
 * @param serviceName Nome do serviço para identificação nos logs
 * @param options Opções adicionais do Pino
 */
export function createLogger(serviceName: string, options?: Partial<LoggerOptions>): Logger {
  const finalOptions = isDevelopment ? devOptions : baseOptions;
  
  return pino({
    ...finalOptions,
    ...options,
    name: serviceName,
  });
}

/**
 * Cria um child logger com contexto adicional fixo
 * Útil para módulos específicos dentro de um serviço
 */
export function createChildLogger(
  parent: Logger, 
  bindings: Record<string, unknown>
): Logger {
  return parent.child(bindings);
}

export const logger = createLogger(process.env.SERVICE_NAME || 'alice');

export type { Logger };

// Exportar AsyncLocalStorage para uso em shared-utils
export { logContextStorage };
