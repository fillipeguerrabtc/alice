import { createLogger } from '@alice/logger';
import { generateInternalAuthHeaders } from '../rbac/middleware.js';
import type { Role } from '../rbac/types.js';
import { getContextHeaders } from '../async-context.js';

const logger = createLogger('shared-utils');

const LLM_GATEWAY_URL = process.env.LLM_GATEWAY_URL?.trim() || null;

function readInternalApiSecret(): string {
  return process.env.INTERNAL_API_SECRET || '';
}

export interface LlmGatewayContext {
  route: string;
  tenantId: string;
  userId?: string;
  role?: Role;
  customRoleId?: string;
  conversationId?: string;
  namespaceId?: string;
  agentId?: string;
}

export interface LlmGatewayCompleteParams {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  config?: { model?: string; temperature?: number; maxTokens?: number };
  context: LlmGatewayContext;
  extraBody?: Record<string, unknown>;
  requestOptions?: { timeout?: number; priority?: 'low' | 'normal' | 'high' | 'critical' };
}

export interface GatewayCompleteResult {
  success: boolean;
  data?: unknown;
  error?: string;
  latencyMs: number;
}

export function buildLlmGatewayAuthHeaders(context: LlmGatewayContext): Record<string, string> {
  if (context.userId) {
    return {
      ...generateInternalAuthHeaders({
        userId: context.userId,
        tenantId: context.tenantId,
        role: context.role ?? 'operator',
        customRoleId: context.customRoleId,
      }),
    };
  }

  const secret = readInternalApiSecret();
  if (!secret) {
    return {};
  }

  return {
    'X-Internal-Api-Secret': secret,
  };
}

export function buildLlmGatewayRequestHeaders(context: LlmGatewayContext): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...getContextHeaders(),
    ...buildLlmGatewayAuthHeaders(context),
  };
}

export async function callGatewayComplete(params: LlmGatewayCompleteParams): Promise<GatewayCompleteResult> {
  const start = Date.now();
  if (!LLM_GATEWAY_URL) {
    return { success: false, error: 'LLM_GATEWAY_URL não configurado', latencyMs: Date.now() - start };
  }

  try {
    const url = `${LLM_GATEWAY_URL}/api/llm/complete`;
    const requestHeaders = buildLlmGatewayRequestHeaders(params.context);
    const res = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        messages: params.messages,
        config: params.config ?? {},
        context: params.context,
        extraBody: params.extraBody,
        requestOptions: params.requestOptions,
      }),
      signal: AbortSignal.timeout(params.requestOptions?.timeout ?? 60000),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Gateway HTTP ${res.status}: ${errText.slice(0, 300)}`, latencyMs };
    }
    const data = (await res.json()) as unknown;
    return { success: true, data, latencyMs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, route: params.context.route }, 'Falha ao chamar LLM Gateway');
    return { success: false, error: message, latencyMs: Date.now() - start };
  }
}

export function isGatewayConfigured(): boolean {
  return Boolean(LLM_GATEWAY_URL);
}
