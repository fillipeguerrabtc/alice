/**
 * Frontend Logger - Alice Enterprise Platform
 * 
 * Logger estruturado para frontend (Regra 8 - console.log PROIBIDO).
 * Envia eventos para observability stack via fetch API.
 * 
 * @module frontend-logger
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
  service: string;
}

function createLogEntry(level: LogLevel, message: string, context?: Record<string, unknown>): LogEntry {
  return {
    level,
    message,
    context,
    timestamp: new Date().toISOString(),
    service: 'frontend',
  };
}

function sendToObservability(entry: LogEntry): void {
  const payload = JSON.stringify(entry);
  
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/observability/logs', payload);
  } else {
    fetch('/api/observability/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }
}

export const frontendLogger = {
  debug(message: string, context?: Record<string, unknown>): void {
    const entry = createLogEntry('debug', message, context);
    sendToObservability(entry);
  },

  info(message: string, context?: Record<string, unknown>): void {
    const entry = createLogEntry('info', message, context);
    sendToObservability(entry);
  },

  warn(message: string, context?: Record<string, unknown>): void {
    const entry = createLogEntry('warn', message, context);
    sendToObservability(entry);
  },

  error(message: string, context?: Record<string, unknown>): void {
    const entry = createLogEntry('error', message, context);
    sendToObservability(entry);
  },
};
