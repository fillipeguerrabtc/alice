/**
 * Cliente LLM Gateway - Integrations Service
 *
 * Chamadas LLM (sinais trading, postmortem) via Gateway quando configurado.
 * Gateway faz resolução de namespace/agente, registro de fallbacks e proxy para GPU.
 *
 * Plano Enterprise - Agentes Especializados por Namespace
 *
 * @author Fillipe Guerra
 * @since 12/02/2026
 */

import { createLogger } from '@alice/logger';

const logger = createLogger('integrations-service');

const LLM_GATEWAY_URL = process.env.LLM_GATEWAY_URL?.trim() || null;
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';

export interface LlmGatewayContext {
  route: string;
  tenantId: string;
  userId?: string;
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

/** Retorno compatível com GpuResponse para drop-in replacement */
export interface GatewayCompleteResult {
  success: boolean;
  data?: unknown;
  error?: string;
  latencyMs: number;
}

/**
 * Chama LLM Gateway /api/llm/complete quando LLM_GATEWAY_URL está configurado.
 * Retorna formato compatível com requestGpu para substituição direta.
 */
export async function callGatewayComplete(params: LlmGatewayCompleteParams): Promise<GatewayCompleteResult> {
  const start = Date.now();
  if (!LLM_GATEWAY_URL) {
    return { success: false, error: 'LLM_GATEWAY_URL não configurado', latencyMs: Date.now() - start };
  }
  try {
    const url = `${LLM_GATEWAY_URL}/api/llm/complete`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Secret': INTERNAL_API_SECRET,
      },
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

/** Indica se o Gateway está configurado e deve ser usado */
export function isGatewayConfigured(): boolean {
  return Boolean(LLM_GATEWAY_URL);
}
