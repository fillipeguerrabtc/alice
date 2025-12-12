import pino, { Logger, LoggerOptions } from 'pino';
import { AsyncLocalStorage } from 'async_hooks';

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

function resolveLogLevel(): string {
  // Ordem de precedência:
  // 1) PINO_LOG_LEVEL: usado principalmente em testes para silenciar output
  // 2) LOG_LEVEL: padrão do monorepo
  // 3) default: debug fora de produção, info em produção
  return (
    process.env.PINO_LOG_LEVEL ||
    process.env.LOG_LEVEL ||
    (isProductionEnv() ? 'info' : 'debug')
  );
}

export interface LogContext {
  correlationId?: string;
  requestId?: string;
  tenantId?: string;
  userId?: string;
}

const logContextStorage = new AsyncLocalStorage<LogContext>();

export function getLogContext(): LogContext | undefined {
  return logContextStorage.getStore();
}

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return logContextStorage.run(context, fn);
}

export function setLogContext(context: LogContext): void {
  const store = logContextStorage.getStore();
  if (store) {
    Object.assign(store, context);
  }
}

function buildBaseOptions(): LoggerOptions {
  return {
    level: resolveLogLevel(),
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (bindings) => ({
        pid: bindings.pid,
        host: bindings.hostname,
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
}

function buildDevOptions(): LoggerOptions {
  const base = buildBaseOptions();
  return {
    ...base,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
    mixin: base.mixin,
  };
}

let baseSingletonLogger: Logger | null = null;

function getBaseLogger(): Logger {
  if (!baseSingletonLogger) {
    const finalOptions = isProductionEnv() ? buildBaseOptions() : buildDevOptions();
    baseSingletonLogger = pino({
      ...finalOptions,
      name: 'alice-platform',
    });
  }
  return baseSingletonLogger;
}

export function createLogger(serviceName: string, bindings?: Record<string, unknown>): Logger {
  const base = getBaseLogger();
  return base.child({ module: serviceName, ...bindings });
}

export function createChildLogger(
  parent: Logger, 
  bindings: Record<string, unknown>
): Logger {
  return parent.child(bindings);
}

// =============================================================================
// Logger default (lazy) - evita side-effect no import
// Motivo: em testes (Vitest), `setupFiles` define LOG_LEVEL/PINO_LOG_LEVEL.
// Se criarmos logger no import, ele pode nascer com level errado e gerar WARNs.
// =============================================================================

let defaultLoggerInstance: Logger | null = null;

function getDefaultLogger(): Logger {
  if (!defaultLoggerInstance) {
    defaultLoggerInstance = createLogger(process.env.SERVICE_NAME || 'alice');
  }
  return defaultLoggerInstance;
}

// Export compatível com API existente (logger como objeto), mas lazy via Proxy.
//
// Requisitos enterprise:
// - Evitar alocação de novas funções a cada acesso (ex.: logger.error === logger.error)
// - Encaminhar operações de reflexão/enumeração para evitar comportamento "surpreendente"
//   (ex.: 'error' in logger, Reflect.ownKeys(logger), etc.)
const boundMethodCache = new Map<PropertyKey, unknown>();

function getRealLoggerRecord(): Record<PropertyKey, unknown> {
  return getDefaultLogger() as unknown as Record<PropertyKey, unknown>;
}

export const logger: Logger = new Proxy({} as Logger, {
  get(_target, prop) {
    const cached = boundMethodCache.get(prop);
    if (cached !== undefined) {
      return cached;
    }

    const real = getRealLoggerRecord();
    const value = Reflect.get(real, prop, real);

    if (typeof value === 'function') {
      const bound = (value as (...args: unknown[]) => unknown).bind(real);
      boundMethodCache.set(prop, bound);
      return bound;
    }

    return value;
  },

  set(_target, prop, value) {
    // Se alguém sobrescrever um método/propriedade, invalidar cache para manter consistência.
    boundMethodCache.delete(prop);
    const real = getRealLoggerRecord();
    return Reflect.set(real, prop, value, real);
  },

  deleteProperty(_target, prop) {
    boundMethodCache.delete(prop);
    const real = getRealLoggerRecord();
    return Reflect.deleteProperty(real, prop);
  },

  has(_target, prop) {
    const real = getRealLoggerRecord();
    return Reflect.has(real, prop);
  },

  ownKeys() {
    const real = getRealLoggerRecord();
    return Reflect.ownKeys(real);
  },

  getOwnPropertyDescriptor(_target, prop) {
    const real = getRealLoggerRecord();
    // Invariants do Proxy: este trap deve reportar apenas propriedades *próprias*.
    // Não caminhar no prototype chain evita inconsistência com `ownKeys()` e reflexão.
    const desc = Reflect.getOwnPropertyDescriptor(real, prop);
    // Por segurança, não expor descritores não-configuráveis através do Proxy.
    if (desc && desc.configurable === false) {
      return undefined;
    }
    return desc;
  },

  defineProperty(_target, prop, attributes) {
    boundMethodCache.delete(prop);
    const real = getRealLoggerRecord();
    return Reflect.defineProperty(real, prop, attributes);
  },
}) as unknown as Logger;

export type { Logger };

export { logContextStorage };
