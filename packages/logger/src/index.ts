import pino, { Logger, LoggerOptions } from 'pino';
import { AsyncLocalStorage } from 'async_hooks';

const isDevelopment = process.env.NODE_ENV !== 'production';

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

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
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

let baseSingletonLogger: Logger | null = null;

function getBaseLogger(): Logger {
  if (!baseSingletonLogger) {
    const finalOptions = isDevelopment ? devOptions : baseOptions;
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

export const logger = createLogger(process.env.SERVICE_NAME || 'alice');

export type { Logger };

export { logContextStorage };
