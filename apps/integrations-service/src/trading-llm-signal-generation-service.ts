import { createTradingSignalEnginePipelineService } from './trading-signal-engine-pipeline-service.js';
import type {
  TradingSignalGenerationRequest,
  TradingSignalGenerationServiceDeps,
  TradingSignalTradePlanBase,
} from './trading-signal-engine-types.js';

export function createTradingLlmSignalGenerationService<
  TProfileRow,
  TAgent extends { id: string; namespaceId?: string | null; modeloBase?: string | null },
  TNamespace extends { id: string } | null,
  TTradePlan extends TradingSignalTradePlanBase,
>(deps: TradingSignalGenerationServiceDeps<TProfileRow, TAgent, TNamespace, TTradePlan>) {
  const pipeline = createTradingSignalEnginePipelineService<TProfileRow, TAgent, TNamespace, TTradePlan>(deps);

  async function generateTradingSignalFromLlm(params: TradingSignalGenerationRequest) {
    const agenticSettings = await deps.getAgenticSettingsOrDefault(params.tenantId);
    if (!agenticSettings.tradingEnabled) {
      deps.logger.warn({ tenantId: params.tenantId }, 'Agentic Trading desabilitado - gerando sinal sem execução automática');
    }

    const legacySignalResult = await deps.generateLegacyInstitutionalSignal({
      tenantId: params.tenantId,
      userId: params.userId,
      symbol: params.symbol,
      source: params.source,
      marketType: params.marketType,
      marginMode: params.marginMode,
      legacyFlowEnabled: deps.isLegacyInstitutionalFlowEnabled(),
    });
    if (legacySignalResult) {
      return legacySignalResult;
    }

    return pipeline.executeSignalPipeline(params);
  }

  return {
    generateTradingSignalFromLlm,
  };
}
