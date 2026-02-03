/**
 * Frontend Logger - Alice Enterprise Platform
 * 
 * Logger estruturado para frontend (Regra 8 - console.log PROIBIDO).
 * Envia eventos para observability stack via fetch API com retry e queue.
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

const LOG_ENDPOINT = '/api/observability/logs';
const MAX_QUEUE_SIZE = 100;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const FLUSH_INTERVAL_MS = 5000;

const logQueue: LogEntry[] = [];
let isFlushScheduled = false;

function createLogEntry(level: LogLevel, message: string, context?: Record<string, unknown>): LogEntry {
  return {
    level,
    message,
    context,
    timestamp: new Date().toISOString(),
    service: 'frontend',
  };
}

async function sendWithRetry(entry: LogEntry, retries = 0): Promise<boolean> {
  try {
    const payload = JSON.stringify(entry);
    
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon(LOG_ENDPOINT, blob)) {
        return true;
      }
    }

    const response = await fetch(LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      credentials: 'include',
    });

    return response.ok || response.status === 202;
  } catch {
    if (retries < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retries + 1)));
      return sendWithRetry(entry, retries + 1);
    }
    return false;
  }
}

function enqueueLog(entry: LogEntry): void {
  if (logQueue.length >= MAX_QUEUE_SIZE) {
    logQueue.shift();
  }
  logQueue.push(entry);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (isFlushScheduled) return;
  isFlushScheduled = true;
  
  setTimeout(async () => {
    isFlushScheduled = false;
    await flushQueue();
  }, FLUSH_INTERVAL_MS);
}

async function flushQueue(): Promise<void> {
  while (logQueue.length > 0) {
    const entry = logQueue[0];
    const success = await sendWithRetry(entry);
    if (success) {
      logQueue.shift();
    } else {
      scheduleFlush();
      break;
    }
  }
}

function sendToObservability(entry: LogEntry): void {
  sendWithRetry(entry).then(success => {
    if (!success) {
      enqueueLog(entry);
    }
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    for (const entry of logQueue) {
      const payload = JSON.stringify(entry);
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon?.(LOG_ENDPOINT, blob);
    }
  });
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

  flush(): Promise<void> {
    return flushQueue();
  },
};
