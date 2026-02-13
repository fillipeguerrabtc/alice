import { describe, expect, it } from 'vitest';
import { createDemoOrder, DemoTradingBusinessError } from '../../../apps/integrations-service/src/demo-trading-engine.js';

describe('Demo Trading Engine - validações por mercado', () => {
  const baseParams = {
    tenantId: 'tenant-test',
    symbol: 'XBTUSDTM',
    side: 'buy' as const,
    orderType: 'market' as const,
    size: 1,
  };

  it('deve rejeitar size inválido antes de tocar em DB/API', async () => {
    await expect(
      createDemoOrder({
        ...baseParams,
        marketType: 'futures',
        size: 0,
      })
    ).rejects.toMatchObject<Partial<DemoTradingBusinessError>>({
      name: 'DemoTradingBusinessError',
      code: 'INVALID_INPUT',
      statusCode: 422,
    });
  });

  it('deve rejeitar leverage inválida (NaN/<=0)', async () => {
    await expect(
      createDemoOrder({
        ...baseParams,
        marketType: 'futures',
        leverage: Number.NaN,
      })
    ).rejects.toMatchObject<Partial<DemoTradingBusinessError>>({
      name: 'DemoTradingBusinessError',
      code: 'INVALID_INPUT',
      statusCode: 422,
    });
  });

  it('deve rejeitar leverage > 1x no mercado spot', async () => {
    await expect(
      createDemoOrder({
        ...baseParams,
        marketType: 'spot',
        leverage: 2,
      })
    ).rejects.toMatchObject<Partial<DemoTradingBusinessError>>({
      name: 'DemoTradingBusinessError',
      code: 'INVALID_INPUT',
      statusCode: 422,
    });
  });

  it('deve rejeitar leverage acima do limite no futures demo', async () => {
    await expect(
      createDemoOrder({
        ...baseParams,
        marketType: 'futures',
        leverage: 126,
      })
    ).rejects.toMatchObject<Partial<DemoTradingBusinessError>>({
      name: 'DemoTradingBusinessError',
      code: 'INVALID_INPUT',
      statusCode: 422,
    });
  });

  it('deve rejeitar leverage acima do limite no margin demo', async () => {
    await expect(
      createDemoOrder({
        ...baseParams,
        marketType: 'margin',
        leverage: 11,
      })
    ).rejects.toMatchObject<Partial<DemoTradingBusinessError>>({
      name: 'DemoTradingBusinessError',
      code: 'INVALID_INPUT',
      statusCode: 422,
    });
  });
});
