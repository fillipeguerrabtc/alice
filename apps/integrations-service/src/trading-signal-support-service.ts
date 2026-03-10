import * as kucoinClient from './kucoinClient.js';
import * as kucoinSpotClient from './kucoinSpotClient.js';

type TradingMarketType = 'futures' | 'spot' | 'margin';

export function createTradingSignalSupportService() {
  function splitSymbolPair(symbol: string): { base: string; quote: string } {
    const parts = symbol.split('-').map((value) => value.trim()).filter(Boolean);
    if (parts.length !== 2) {
      throw new Error(`Símbolo inválido para arbitragem triangular: ${symbol}`);
    }
    return { base: parts[0], quote: parts[1] };
  }

  function deriveIntermediateAssetsFromSymbols(symbols: string[]): string[] {
    const assets = new Set<string>();
    for (const symbol of symbols) {
      try {
        const { base, quote } = splitSymbolPair(symbol);
        assets.add(base.toUpperCase());
        assets.add(quote.toUpperCase());
      } catch {
        continue;
      }
    }
    return Array.from(assets).sort((a, b) => a.localeCompare(b));
  }

  function mapTradingErrorToUserMessage(error: Error): { message: string; code: string } {
    const msg = error.message.toLowerCase();
    if (msg.includes('trading_scope_required') || msg.includes('lora') || msg.includes('namespace trading obrigatório'))
      return { message: 'Governança Trading: namespace/agente/LoRA ativo obrigatório. Revise a configuração de Training.', code: 'TRADING_SCOPE_REQUIRED' };
    if (msg.includes('timeout') || msg.includes('gpu') || msg.includes('temporariamente indisponível'))
      return { message: 'Serviço de IA temporariamente indisponível. Tente novamente em alguns segundos.', code: 'GPU_TIMEOUT' };
    if (msg.includes('símbolo inválido') || msg.includes('invalid symbol') || msg.includes('formato de símbolo'))
      return { message: 'Símbolo não suportado para este mercado.', code: 'INVALID_SYMBOL' };
    if (msg.includes('taxas') || msg.includes('fee') || msg.includes('trade fee'))
      return { message: 'Não foi possível obter taxas de trading. Verifique a configuração.', code: 'FEE_ERROR' };
    if (msg.includes('circuit breaker'))
      return { message: 'Serviço KuCoin temporariamente indisponível. Aguarde e tente novamente.', code: 'KUCOIN_UNAVAILABLE' };
    if (msg.includes('credenciais') || msg.includes('não configurad'))
      return { message: 'Credenciais de API não configuradas. Verifique a configuração no painel de administração.', code: 'CREDENTIALS_MISSING' };
    if (msg.includes('resposta do llm vazia') || msg.includes('json'))
      return { message: 'A IA não conseguiu gerar uma resposta válida. Tente novamente.', code: 'LLM_PARSE_ERROR' };
    return { message: 'Erro ao gerar sinal de trading. Tente novamente.', code: 'UNKNOWN' };
  }

  async function resolveDefaultSymbolForMarketType(params: {
    auth: { tenantId: string; userId: string };
    marketType: TradingMarketType;
  }): Promise<string> {
    if (params.marketType === 'futures') {
      const contracts = await kucoinClient.getActiveContracts();
      const contract = contracts[0];
      if (!contract?.symbol) {
        throw new Error('Não foi possível determinar símbolo Futures padrão na KuCoin.');
      }
      return contract.symbol;
    }
    const symbols = await kucoinSpotClient.getSpotSymbols();
    const symbol = symbols[0]?.symbol;
    if (!symbol) {
      throw new Error('Não foi possível determinar símbolo Spot/Margin padrão na KuCoin.');
    }
    return symbol;
  }

  return {
    splitSymbolPair,
    deriveIntermediateAssetsFromSymbols,
    mapTradingErrorToUserMessage,
    resolveDefaultSymbolForMarketType,
  };
}
