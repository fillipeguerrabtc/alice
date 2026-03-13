import { describe, expect, it } from 'vitest';
import {
  buildUnsupportedTechniqueScores,
  filterSupportedTradingTechniques,
  resolveTradingTechniqueCapabilities,
} from '../../../apps/integrations-service/src/trading-technique-capability-service';

describe('trading technique capability service', () => {
  it('marca directional technical como suportada', () => {
    const capabilities = resolveTradingTechniqueCapabilities({
      techniques: ['scalping'],
      marketType: 'futures',
      dataSources: { orderBook: false, news: false, trainingData: true },
      hasArbitrageConfig: false,
    });

    expect(capabilities).toHaveLength(1);
    expect(capabilities[0]?.supportLevel).toBe('supported');
    expect(capabilities[0]?.family).toBe('directional_technical');
  });

  it('marca basis/funding/carry como não suportada no contexto atual', () => {
    const capabilities = resolveTradingTechniqueCapabilities({
      techniques: ['cash_and_carry', 'basis_trade', 'funding_arbitrage'],
      marketType: 'futures',
      dataSources: { orderBook: true, news: false, trainingData: true },
      hasArbitrageConfig: false,
    });

    for (const capability of capabilities) {
      expect(capability.supportLevel).toBe('not_supported_for_current_context');
      expect(capability.reasonCode).toBe('BASIS_FUNDING_DATA_UNAVAILABLE');
    }
  });

  it('marca técnicas de microstructure como blocked quando orderBook está desabilitado', () => {
    const capabilities = resolveTradingTechniqueCapabilities({
      techniques: ['grid_trading'],
      marketType: 'spot',
      dataSources: { orderBook: false, news: false, trainingData: true },
      hasArbitrageConfig: false,
    });

    expect(capabilities[0]?.supportLevel).toBe('blocked');
    expect(capabilities[0]?.reasonCode).toBe('ORDERBOOK_SOURCE_DISABLED');
  });

  it('marca técnicas de microstructure como não suportadas mesmo com orderBook habilitado', () => {
    const capabilities = resolveTradingTechniqueCapabilities({
      techniques: ['grid_trading'],
      marketType: 'spot',
      dataSources: { orderBook: true, news: false, trainingData: true },
      hasArbitrageConfig: false,
    });

    expect(capabilities[0]?.supportLevel).toBe('not_supported_for_current_context');
    expect(capabilities[0]?.reasonCode).toBe('MICROSTRUCTURE_PIPELINE_NOT_IMPLEMENTED');
  });

  it('controla suporte de arbitragem triangular por contexto', () => {
    const blockedByConfig = resolveTradingTechniqueCapabilities({
      techniques: ['arbitrage_triangular'],
      marketType: 'spot',
      dataSources: { orderBook: false, news: false, trainingData: true },
      hasArbitrageConfig: false,
    });
    expect(blockedByConfig[0]?.supportLevel).toBe('blocked');
    expect(blockedByConfig[0]?.reasonCode).toBe('ARBITRAGE_CONFIG_REQUIRED');

    const notSupportedInFutures = resolveTradingTechniqueCapabilities({
      techniques: ['arbitrage_triangular'],
      marketType: 'futures',
      dataSources: { orderBook: false, news: false, trainingData: true },
      hasArbitrageConfig: true,
    });
    expect(notSupportedInFutures[0]?.supportLevel).toBe('not_supported_for_current_context');
    expect(notSupportedInFutures[0]?.reasonCode).toBe('ARBITRAGE_REQUIRES_SPOT_OR_MARGIN');

    const supported = resolveTradingTechniqueCapabilities({
      techniques: ['arbitrage_triangular'],
      marketType: 'spot',
      dataSources: { orderBook: false, news: false, trainingData: true },
      hasArbitrageConfig: true,
    });
    expect(supported[0]?.supportLevel).toBe('supported');
    expect(supported[0]?.reasonCode).toBeNull();
  });

  it('retorna somente técnicas suportadas e converte não suportadas em score estruturado', () => {
    const capabilities = resolveTradingTechniqueCapabilities({
      techniques: ['scalping', 'cash_and_carry', 'grid_trading'],
      marketType: 'futures',
      dataSources: { orderBook: false, news: false, trainingData: true },
      hasArbitrageConfig: false,
    });

    const supported = filterSupportedTradingTechniques(capabilities);
    const unsupportedScores = buildUnsupportedTechniqueScores(capabilities);

    expect(supported).toEqual(['scalping']);
    expect(unsupportedScores).toHaveLength(2);
    expect(unsupportedScores.every((score) => score.signal === 'neutral')).toBe(true);
    expect(unsupportedScores.every((score) => score.confidence === 0)).toBe(true);
  });
});

