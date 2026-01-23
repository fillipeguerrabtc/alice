/**
 * Eventos Agentic - Streaming seguro para UI
 *
 * Define schema e utilitário de redaction para payloads.
 * Documentação em PT-BR (Regra 10 CLAUDE.md).
 */

export type AgentEventPhase =
  | 'planning'
  | 'tool'
  | 'approval'
  | 'execution'
  | 'llm'
  | 'finalizing'
  | 'system';

export type AgentEventStatus =
  | 'start'
  | 'in_progress'
  | 'success'
  | 'error'
  | 'skipped'
  | 'pending'
  | 'approved'
  | 'rejected';

export interface AgentEvent {
  /** ID único do evento */
  id: string;
  /** Timestamp ISO */
  ts: string;
  /** Fase do fluxo */
  phase: AgentEventPhase;
  /** Ação resumida (ex: rag_web, stack_ops, payments) */
  action: string;
  /** Status do evento */
  status: AgentEventStatus;
  /** Mensagem curta para UI */
  message?: string;
  /** Payload redigido para inspeção */
  payload?: Record<string, unknown>;
  /** Duração da ação em ms (quando aplicável) */
  durationMs?: number;
  /** Correlation para agrupar eventos */
  correlationId?: string;
  /** Relação pai->filho (opcional) */
  parentId?: string;
}

export interface RedactionOptions {
  maxStringLength?: number;
  maxDepth?: number;
  maxArrayLength?: number;
  maxKeys?: number;
}

const DEFAULT_REDACTION_OPTIONS: Required<RedactionOptions> = {
  maxStringLength: 400,
  maxDepth: 4,
  maxArrayLength: 50,
  maxKeys: 50,
};

const SENSITIVE_KEYS = [
  'password',
  'pass',
  'secret',
  'token',
  'api_key',
  'apikey',
  'key',
  'authorization',
  'cookie',
  'session',
  'client_secret',
  'private_key',
];

const isSensitiveKey = (key: string): boolean => {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
  return SENSITIVE_KEYS.some((entry) => normalized.includes(entry.replace(/[^a-z0-9_]/g, '')));
};

const truncateString = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
};

const redactValue = (
  value: unknown,
  options: Required<RedactionOptions>,
  depth: number
): unknown => {
  if (depth > options.maxDepth) {
    return '[REDACTED_DEPTH]';
  }

  if (typeof value === 'string') {
    return truncateString(value, options.maxStringLength);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    const sliced = value.slice(0, options.maxArrayLength);
    return sliced.map((item) => redactValue(item, options, depth + 1));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return `[BINARY:${value.length}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, options.maxKeys);
    const redacted: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      if (isSensitiveKey(key)) {
        redacted[key] = '[REDACTED]';
        continue;
      }
      redacted[key] = redactValue(entryValue, options, depth + 1);
    }
    return redacted;
  }

  return '[UNSUPPORTED_PAYLOAD]';
};

/**
 * Redige payloads para streaming em UI.
 */
export function redactSensitivePayload(
  payload: unknown,
  options?: RedactionOptions
): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const merged = { ...DEFAULT_REDACTION_OPTIONS, ...(options ?? {}) };
  const redacted = redactValue(payload, merged, 0);
  if (redacted && typeof redacted === 'object') {
    return redacted as Record<string, unknown>;
  }
  return undefined;
}
