import {
  callGatewayComplete,
  type EffectiveReasoningMode,
  GpuRequestPriority,
  GpuServiceType,
  isGatewayConfigured,
  type ReasoningMode,
  requestGpu,
  resolveReasoningRequest,
  TRADING_LLM_SIGNAL_JSON_SCHEMA,
} from '@alice/shared-utils';
import type { createLogger } from '@alice/logger';
import { resolveModelWithAdapter } from './lora-adapter-resolver.js';

type TradingLlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

type TradingSignalLlmCompletionParams = {
  messages: TradingLlmMessage[];
  tenantId: string;
  userId: string;
  symbol: string;
  marketType?: 'futures' | 'spot' | 'margin';
  namespaceId?: string;
  agentId?: string;
  baseModel: string;
  temperature: number;
  maxCompletionTokens: number;
  hasArbitrageTechnique: boolean;
  reasoningMode?: ReasoningMode;
};

export function createTradingLlmExecutionService(deps: {
  logger: Pick<ReturnType<typeof createLogger>, 'info' | 'warn' | 'error'>;
  llmSignalTimeoutMs: number;
  llmSignalTimeoutArbitrageMs: number;
  createTradingScopeRequiredError: (message: string) => Error;
}) {
  async function requestTradingSignalCompletion(params: TradingSignalLlmCompletionParams): Promise<{
    llmContent: string;
    resolvedModel: string;
    gpuLatencyMs: number;
    requestedReasoningMode: ReasoningMode;
    resolvedReasoningMode: EffectiveReasoningMode;
    reasonResolution: string;
  }> {
    const llmTimeoutMs = params.hasArbitrageTechnique
      ? deps.llmSignalTimeoutArbitrageMs
      : deps.llmSignalTimeoutMs;
    const maxGpuRetries = 2;
    const gpuRequestStartMs = Date.now();
    let gpuResponse: Awaited<ReturnType<typeof requestGpu>> | null = null;
    let lastGpuError: Error | null = null;
    const lastUserMessage = [...params.messages].reverse()
      .find((message) => message.role === 'user')
      ?.content;
    const resolvedReasoning = resolveReasoningRequest({
      requestedMode: params.reasoningMode,
      userMessage: lastUserMessage,
      messageCount: params.messages.length,
      maxTokens: params.maxCompletionTokens,
      requiresStructuredOutput: true,
    });

    const resolvedModel = await resolveModelWithAdapter(params.baseModel, {
      tenantId: params.tenantId,
      namespaceId: params.namespaceId,
      agentId: params.agentId,
    });
    if (resolvedModel === params.baseModel) {
      throw deps.createTradingScopeRequiredError('TRADING_SCOPE_REQUIRED: Adapter LoRA ativo obrigatório para Trading.');
    }

    for (let attempt = 1; attempt <= maxGpuRetries; attempt += 1) {
      try {
        deps.logger.info({
          symbol: params.symbol,
          marketType: params.marketType,
          timeoutMs: llmTimeoutMs,
          model: resolvedModel,
          baseModel: params.baseModel,
          usingLoraAdapter: resolvedModel !== params.baseModel,
          promptTokens: params.messages.reduce((acc, message) => acc + message.content.length, 0),
          maxCompletionTokens: params.maxCompletionTokens,
          requestedReasoningMode: resolvedReasoning.requestedReasoningMode,
          resolvedReasoningMode: resolvedReasoning.resolvedReasoningMode,
          reasonResolution: resolvedReasoning.reasonResolution,
          attempt,
          maxRetries: maxGpuRetries,
          viaGateway: isGatewayConfigured(),
        }, 'Iniciando requisição GPU LLM para geração de sinal trading');

        if (isGatewayConfigured()) {
          const gatewayResponse = await callGatewayComplete({
            messages: params.messages,
            config: {
              model: resolvedModel,
              temperature: params.temperature,
              maxTokens: params.maxCompletionTokens,
            },
            context: {
              route: '/trading',
              tenantId: params.tenantId,
              userId: params.userId,
              namespaceId: params.namespaceId,
              agentId: params.agentId,
            },
            extraBody: {
              alice_reasoning_mode: resolvedReasoning.requestedReasoningMode,
              ...resolvedReasoning.gatewayMetadataExtraBody,
              ...resolvedReasoning.runtimeExtraBody,
              response_format: {
                type: 'json_schema',
                json_schema: TRADING_LLM_SIGNAL_JSON_SCHEMA,
              },
            },
            requestOptions: { timeout: llmTimeoutMs, priority: 'high' },
          });
          gpuResponse = gatewayResponse as Awaited<ReturnType<typeof requestGpu>>;
        } else {
          gpuResponse = await requestGpu({
            serviceType: GpuServiceType.LLM,
            endpoint: '/v1/chat/completions',
            method: 'POST',
            priority: GpuRequestPriority.HIGH,
            timeout: llmTimeoutMs,
            body: {
              model: resolvedModel,
              messages: params.messages,
              response_format: {
                type: 'json_schema',
                json_schema: TRADING_LLM_SIGNAL_JSON_SCHEMA,
              },
              ...resolvedReasoning.runtimeExtraBody,
              max_tokens: params.maxCompletionTokens,
              temperature: params.temperature,
              stream: false,
            },
          });
        }

        if (gpuResponse.success && gpuResponse.data) {
          break;
        }
        lastGpuError = new Error(gpuResponse?.error || 'Falha na resposta do GPU Manager.');
      } catch (error) {
        lastGpuError = error instanceof Error ? error : new Error(String(error));
      }

      if (attempt < maxGpuRetries) {
        const backoffMs = attempt * 5000;
        deps.logger.warn({ attempt, backoffMs, error: lastGpuError?.message }, 'Retry GPU após falha - aguardando backoff');
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    const gpuLatencyMs = Date.now() - gpuRequestStartMs;
    if (!gpuResponse?.success || !gpuResponse?.data) {
      deps.logger.error({
        gpuLatencyMs,
        gpuError: lastGpuError?.message,
        symbol: params.symbol,
        marketType: params.marketType,
        retriesExhausted: maxGpuRetries,
      }, 'Requisição GPU LLM falhou após todas as tentativas para geração de sinal trading');
      throw lastGpuError ?? new Error('Falha na resposta do GPU Manager após retries.');
    }

    deps.logger.info({ gpuLatencyMs, symbol: params.symbol }, 'Requisição GPU LLM completada com sucesso');

    const responseData = gpuResponse.data as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const llmContent = responseData.choices?.[0]?.message?.content?.trim() || '';
    if (!llmContent) {
      throw new Error('Resposta do LLM vazia ou inválida.');
    }

    return {
      llmContent,
      resolvedModel,
      gpuLatencyMs,
      requestedReasoningMode: resolvedReasoning.requestedReasoningMode,
      resolvedReasoningMode: resolvedReasoning.resolvedReasoningMode,
      reasonResolution: resolvedReasoning.reasonResolution,
    };
  }

  return {
    requestTradingSignalCompletion,
  };
}
