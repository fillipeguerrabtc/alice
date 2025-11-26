import pino, { Logger, LoggerOptions } from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

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
};

export function createLogger(serviceName: string, options?: Partial<LoggerOptions>): Logger {
  const finalOptions = isDevelopment ? devOptions : baseOptions;
  
  return pino({
    ...finalOptions,
    ...options,
    name: serviceName,
  });
}

export const logger = createLogger(process.env.SERVICE_NAME || 'alice');

export type { Logger };
