/**
 * Trading Command Parser - Alice Enterprise Platform
 * 
 * Parser de comandos de trading para o chat. Reconhece intenções do usuário
 * para comprar, vender, fechar posições, etc., via linguagem natural.
 * 
 * Comandos suportados:
 * - "compre X BTC" / "buy X BTC"
 * - "venda X BTC" / "sell X BTC"
 * - "feche posição" / "close position"
 * - "cancele ordem {id}"
 * - "status trading" / "minhas posições"
 * - "pare trading" / "pause trading"
 * - "continue trading" / "resume trading"
 * - "assumir controle" / "takeover"
 * - "devolver para alice" / "handback"
 * 
 * Regra 6 - SEM MOCKS: Integração real com KuCoin via integrations-service
 * Regra 8 - TypeScript strict, zero any
 * Regra 13 - Suporte PT-BR e EN
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import { createLogger } from '@alice/logger';

const logger = createLogger('trading-command-parser');

// ============================================================================
// TIPOS
// ============================================================================

/** Tipos de comando de trading */
export type TradingCommandType =
  | 'buy'
  | 'sell'
  | 'close_position'
  | 'cancel_order'
  | 'generate_signal'
  | 'status'
  | 'positions'
  | 'orders'
  | 'pause_trading'
  | 'resume_trading'
  | 'takeover'
  | 'handback'
  | 'set_stop_loss'
  | 'set_take_profit'
  | 'unknown';

/** Resultado do parse de comando */
export interface ParsedTradingCommand {
  type: TradingCommandType;
  isTrading: boolean;
  amount?: number;
  symbol?: string;
  orderId?: string;
  price?: number;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
  marketType?: 'spot' | 'margin' | 'futures';
  marginMode?: 'cross' | 'isolated';
  /**
   * Direção da ordem (buy/sell)
   * CORREÇÃO AUDITORIA 17/12/2025: Campo adicionado para stop orders
   * - Para LONG positions: side='sell' (fechar vendendo)
   * - Para SHORT positions: side='buy' (fechar comprando)
   * Se não especificado, deve ser inferido da posição atual
   */
  side?: 'buy' | 'sell';
  /**
   * Tipo de posição mencionado no comando (long/short)
   * Usado para inferir o side correto se não especificado explicitamente
   */
  positionType?: 'long' | 'short';
  confidence: number;  // 0-1 confiança do parse
  rawText: string;
  matchedPattern?: string;
}

/** Padrão de regex para comando */
interface CommandPattern {
  type: TradingCommandType;
  patterns: RegExp[];
  extractors?: {
    amount?: RegExp;
    symbol?: RegExp;
    orderId?: RegExp;
    price?: RegExp;
    leverage?: RegExp;
  };
}

// ============================================================================
// PADRÕES DE COMANDO (PT-BR e EN)
// ============================================================================

const COMMAND_PATTERNS: CommandPattern[] = [
  // COMPRAR / BUY
  {
    type: 'buy',
    patterns: [
      /\b(compre?|comprar|buy|long)\s+(\d+(?:\.\d+)?)\s*([a-z0-9]{2,15}(?:[-_/][a-z0-9]{2,15})?|contratos?)?\b/i,
      /\b(abrir?|abra|open)\s+(long|compra)\s+(\d+(?:\.\d+)?)\b/i,
      /\b(quero|gostaria\s+de)\s+comprar\s+(\d+(?:\.\d+)?)\b/i,
      /\bcompra\s+(\d+(?:\.\d+)?)\s*([a-z0-9]{2,15}(?:[-_/][a-z0-9]{2,15})?)?\b/i,
    ],
    extractors: {
      amount: /(\d+(?:\.\d+)?)/,
      symbol: /([a-z0-9]{2,15}(?:[-_/][a-z0-9]{2,15})?)/i,
    },
  },

  // VENDER / SELL
  {
    type: 'sell',
    patterns: [
      /\b(venda|vender|sell|short)\s+(\d+(?:\.\d+)?)\s*([a-z0-9]{2,15}(?:[-_/][a-z0-9]{2,15})?|contratos?)?\b/i,
      /\b(abrir?|abra|open)\s+(short|venda)\s+(\d+(?:\.\d+)?)\b/i,
      /\b(quero|gostaria\s+de)\s+vender\s+(\d+(?:\.\d+)?)\b/i,
      /\bvende\s+(\d+(?:\.\d+)?)\s*([a-z0-9]{2,15}(?:[-_/][a-z0-9]{2,15})?)?\b/i,
    ],
    extractors: {
      amount: /(\d+(?:\.\d+)?)/,
      symbol: /([a-z0-9]{2,15}(?:[-_/][a-z0-9]{2,15})?)/i,
    },
  },

  // FECHAR POSIÇÃO / CLOSE POSITION
  {
    type: 'close_position',
    patterns: [
      /\b(feche?|fechar|close)\s+(a\s+)?(posi[çc][ãa]o|position|todas?)\b/i,
      /\b(encerr[ae]r?|encerre)\s+(a\s+)?(posi[çc][ãa]o|opera[çc][ãa]o)\b/i,
      /\bsair?\s+(da\s+)?(posi[çc][ãa]o|opera[çc][ãa]o)\b/i,
      /\b(zerar?|zere)\s+(a\s+)?(posi[çc][ãa]o)?\b/i,
    ],
  },

  // CANCELAR ORDEM
  {
    type: 'cancel_order',
    patterns: [
      /\b(cancel[ae]r?|cancele)\s+(a\s+)?ordem\s*([a-f0-9-]+)?\b/i,
      /\b(cancel)\s+(order)\s*([a-f0-9-]+)?\b/i,
      /\bremov[ae]r?\s+(a\s+)?ordem\s*([a-f0-9-]+)?\b/i,
    ],
    extractors: {
      orderId: /([a-f0-9]{8,}-[a-f0-9-]+)/i,
    },
  },

  // STATUS
  {
    type: 'status',
    patterns: [
      /\b(status|situa[çc][ãa]o)\s+(do\s+)?(trading|opera[çc][õo]es?)\b/i,
      /\bcomo\s+est[áa]\s+(o\s+)?(trading|mercado)\b/i,
      /\b(mostrar?|mostre|ver|show)\s+(o\s+)?(status|resumo)\b/i,
    ],
  },

  // POSIÇÕES
  {
    type: 'positions',
    patterns: [
      /\b(minhas?\s+)?posi[çc][õo]es?\b/i,
      /\b(my\s+)?positions?\b/i,
      /\b(mostrar?|mostre|ver)\s+(as\s+)?posi[çc][õo]es?\b/i,
      /\bonde\s+estou\s+posicionado\b/i,
    ],
  },

  // ORDENS
  {
    type: 'orders',
    patterns: [
      /\b(minhas?\s+)?ordens?\b/i,
      /\b(my\s+)?orders?\b/i,
      /\b(mostrar?|mostre|ver)\s+(as\s+)?ordens?\b/i,
      /\blistar?\s+ordens?\b/i,
    ],
  },

  // GERAR SINAL
  {
    type: 'generate_signal',
    patterns: [
      /\b(gerar?|gere|criar?|crie|fa[çc]a|fa[çc]a\s+um)\s+(sinal|sinais)\b/i,
      /\b(sinal|sinais)\s+(agora|automatico|autom[áa]tico)\b/i,
      /\b(generate|create|make)\s+(signal|signals)\b/i,
      /\b(signal|signals)\s+(now|automatic|auto)\b/i,
    ],
    extractors: {
      symbol: /([a-z0-9]{2,15}(?:[-_/][a-z0-9]{2,15})?)/i,
    },
  },

  // PAUSAR TRADING
  {
    type: 'pause_trading',
    patterns: [
      /\b(pausar?|pause|parar?|pare|stop)\s+(o\s+)?(trading|opera[çc][õo]es?|autom[áa]tico)\b/i,
      /\b(desativ[ae]r?|desative)\s+(o\s+)?(trading|autom[áa]tico)\b/i,
      /\bn[ãa]o\s+(opere|trade)\s+(mais|agora)\b/i,
    ],
  },

  // CONTINUAR TRADING
  {
    type: 'resume_trading',
    patterns: [
      /\b(continuar?|continue|retomar?|retome|resume)\s+(o\s+)?(trading|opera[çc][õo]es?)\b/i,
      /\b(ativ[ae]r?|ative)\s+(o\s+)?(trading|autom[áa]tico)\b/i,
      /\bvoltar?\s+a\s+operar\b/i,
      /\bpode\s+operar\s+(novamente|de\s+novo)\b/i,
    ],
  },

  // TAKEOVER (Assumir Controle Manual)
  {
    type: 'takeover',
    patterns: [
      /\b(assumir?|assuma)\s+(o\s+)?controle\b/i,
      /\b(quero|vou)\s+operar\s+(manualmente|eu\s+mesmo)\b/i,
      /\btakeover\b/i,
      /\bmodo\s+manual\b/i,
      /\beu\s+(quero\s+)?operar\b/i,
    ],
  },

  // HANDBACK (Devolver para Alice)
  {
    type: 'handback',
    patterns: [
      /\b(devolv[ae]r?|devolva)\s+(o\s+)?controle\s+(para\s+)?(alice|ia|bot)\b/i,
      /\b(alice|ia|bot)\s+(pode\s+)?(assumir?|operar)\b/i,
      /\bhandback\b/i,
      /\bmodo\s+(autom[áa]tico|aut[ôo]nomo)\b/i,
      /\bvolta\s+a\s+operar\s+(alice|ia)\b/i,
    ],
  },

  // STOP LOSS
  {
    type: 'set_stop_loss',
    patterns: [
      /\b(coloca[re]?|colocar|set)\s+(um\s+)?stop\s*(loss)?\s*(em|at|@)?\s*\$?(\d+(?:\.\d+)?)\b/i,
      /\bstop\s*(loss)?\s*(em|at|@|:)?\s*\$?(\d+(?:\.\d+)?)\b/i,
    ],
    extractors: {
      price: /\$?(\d+(?:\.\d+)?)/,
    },
  },

  // TAKE PROFIT
  {
    type: 'set_take_profit',
    patterns: [
      /\b(coloca[re]?|colocar|set)\s+(um\s+)?take\s*(profit)?\s*(em|at|@)?\s*\$?(\d+(?:\.\d+)?)\b/i,
      /\btake\s*(profit)?\s*(em|at|@|:)?\s*\$?(\d+(?:\.\d+)?)\b/i,
      /\b(alvo|target)\s*(em|at|@|:)?\s*\$?(\d+(?:\.\d+)?)\b/i,
    ],
    extractors: {
      price: /\$?(\d+(?:\.\d+)?)/,
    },
  },
];

// ============================================================================
// KEYWORDS DE CONTEXTO (para aumentar confiança)
// ============================================================================

const TRADING_CONTEXT_KEYWORDS = [
  'trading', 'trade', 'ordem', 'order',
  'posição', 'position', 'compra', 'venda', 'buy', 'sell',
  'long', 'short', 'futures', 'perpetual', 'alavancagem',
  'leverage', 'stop', 'profit', 'loss', 'mercado', 'market',
  'kucoin', 'exchange', 'crypto', 'cripto', 'dólar', 'dollar',
];

// ============================================================================
// FUNÇÕES DE PARSE
// ============================================================================

/**
 * Verifica se a mensagem tem contexto de trading
 * 
 * CORREÇÃO AUDITORIA 17/12/2025: Corrigido typo no nome da função
 * (hasTradicngContext -> hasTradingContext)
 */
function hasTradingContext(text: string): boolean {
  const lowerText = text.toLowerCase();
  return TRADING_CONTEXT_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

/**
 * Extrai número de um texto
 * NOTA: Função utilizada internamente pelas funções de extração específicas
 */
function _extractNumber(text: string, regex?: RegExp): number | undefined {
  const pattern = regex || /(\d+(?:\.\d+)?)/;
  const match = text.match(pattern);
  return match ? parseFloat(match[1]) : undefined;
}
// Re-exportar como extractNumber para uso externo se necessário
export { _extractNumber as extractNumber };

/**
 * Extrai símbolo do texto
 */
function extractSymbol(text: string): string | undefined {
  const match = text.match(/\b([a-z]{2,10}[-_/][a-z]{2,10}|[a-z]{6,12})\b/i);
  if (!match) return undefined;

  const raw = match[1].trim();
  // Evitar capturar tokens curtos como "btc" sem par explícito
  if (!raw.includes('-') && !raw.includes('/') && raw.length < 6) {
    return undefined;
  }

  return raw.replace('/', '-').toUpperCase();
}

function detectMarketType(text: string, symbol?: string): { marketType?: 'spot' | 'margin' | 'futures'; marginMode?: 'cross' | 'isolated' } {
  const lower = text.toLowerCase();
  const isSpot = /\bspot\b|\bà vista\b|\bavista\b|\bmercado spot\b/.test(lower);
  const isMargin = /\bmargem\b|\bmargin\b/.test(lower);
  const isFutures = /\bfuture\b|\bfutures\b|\bperp\b|\bperpetual\b|\bperpétuo\b|\bperpetuo\b/.test(lower);
  const isIsolated = /\bisolad[ao]\b|\bisolated\b/.test(lower);
  const isCross = /\bcross\b|\bcruzad[ao]\b/.test(lower);

  let marketType: 'spot' | 'margin' | 'futures' | undefined;
  if (isMargin) {
    marketType = 'margin';
  } else if (isSpot) {
    marketType = 'spot';
  } else if (isFutures) {
    marketType = 'futures';
  }

  if (!marketType && symbol && /USDTM$/i.test(symbol)) {
    marketType = 'futures';
  }

  let marginMode: 'cross' | 'isolated' | undefined;
  if (isIsolated) {
    marginMode = 'isolated';
  } else if (isCross) {
    marginMode = 'cross';
  }

  return { marketType, marginMode };
}

/**
 * Extrai ID de ordem do texto
 */
function extractOrderId(text: string): string | undefined {
  const match = text.match(/([a-f0-9]{8,}-[a-f0-9-]+)/i);
  return match ? match[1] : undefined;
}

/**
 * Extrai amount dos grupos capturados do regex match
 * 
 * CORREÇÃO 17/12/2025: Não usar extractNumber(text) que pega o primeiro número do texto.
 * Para "10x compre 5 BTC", extractNumber retornaria 10 (errado) ao invés de 5 (correto).
 * Agora extraímos o amount dos grupos capturados pelo regex pattern.
 * 
 * Autor: Fillipe Guerra
 */
function extractAmountFromMatch(match: RegExpMatchArray): number | undefined {
  // Percorrer grupos capturados (ignora grupo 0 que é o match completo)
  for (let i = 1; i < match.length; i++) {
    const group = match[i];
    // Verificar se o grupo é um número válido (inteiro ou decimal)
    if (group && /^\d+(?:\.\d+)?$/.test(group)) {
      return parseFloat(group);
    }
  }
  return undefined;
}

/**
 * Parse principal - analisa texto e retorna comando identificado
 * 
 * CORREÇÃO 17/12/2025: Bug fix crítico na extração de amounts.
 * Antes: extractNumber(text) pegava o primeiro número do texto inteiro
 * Agora: Usa os grupos capturados do regex para extrair o amount correto
 * 
 * Exemplo do bug corrigido:
 * - Input: "10x compre 5 BTC"
 * - Antes: amount = 10 (ERRADO - pegava primeiro número)
 * - Depois: amount = 5 (CORRETO - do grupo capturado pelo regex)
 */
export function parseTradingCommand(text: string): ParsedTradingCommand {
  const result: ParsedTradingCommand = {
    type: 'unknown',
    isTrading: false,
    confidence: 0,
    rawText: text,
  };

  const normalizedText = text.trim().toLowerCase();

  // Verificar contexto de trading
  // CORREÇÃO AUDITORIA 17/12/2025: Corrigido typo hasTradicngContext -> hasTradingContext
  // Bug CRÍTICO: ReferenceError em runtime - função não existia com esse nome
  const hasContext = hasTradingContext(normalizedText);

  // Tentar match com cada padrão
  for (const pattern of COMMAND_PATTERNS) {
    for (const regex of pattern.patterns) {
      // CORREÇÃO: Usar match() para obter grupos capturados, não apenas test()
      const match = normalizedText.match(regex);
      if (match) {
        result.type = pattern.type;
        result.isTrading = true;
        result.matchedPattern = regex.source;

        // Calcular confiança base
        result.confidence = hasContext ? 0.9 : 0.7;

        // Extrair dados adicionais baseado no tipo
        if (pattern.type === 'buy' || pattern.type === 'sell') {
          // CORREÇÃO: Extrair amount dos grupos capturados, NÃO do texto inteiro
          result.amount = extractAmountFromMatch(match);
          result.symbol = extractSymbol(text);
          const marketSelection = detectMarketType(text, result.symbol);
          result.marketType = marketSelection.marketType;
          result.marginMode = marketSelection.marginMode;
          
          // Verificar alavancagem mencionada (buscar padrão Nx onde N é número seguido de 'x')
          // CORREÇÃO 17/12/2025: Removida verificação incorreta `leverageValue !== result.amount`
          // O padrão "10x" ou "20x" É leverage - não importa se coincide com amount
          // Exemplo: "compre 10 BTC 10x" deve resultar em amount=10 E leverage=10
          // A verificação anterior descartava leverage válido quando valores coincidiam
          const leverageMatch = text.match(/(\d+)x\b/i);
          if (leverageMatch) {
            const leverageValue = parseInt(leverageMatch[1]);
            // Validar que leverage está em range razoável (1-125x para KuCoin Futures)
            if (leverageValue >= 1 && leverageValue <= 125) {
              result.leverage = leverageValue;
            }
          }

          // Aumentar confiança se tiver amount
          if (result.amount) {
            result.confidence = Math.min(result.confidence + 0.1, 1);
          }
        }

        if (pattern.type === 'cancel_order') {
          result.orderId = extractOrderId(text);
        }

        if (pattern.type === 'set_stop_loss' || pattern.type === 'set_take_profit') {
          // CORREÇÃO 17/12/2025: Usar grupos capturados do regex, não primeiro número do texto
          // Para "10x alavancagem, stop em 45000", antes retornava 10, agora retorna 45000
          // Mesma correção aplicada para buy/sell amounts
          const price = extractAmountFromMatch(match);
          if (price !== undefined) {
            result.price = price;
            if (pattern.type === 'set_stop_loss') {
              result.stopLoss = result.price;
            } else {
              result.takeProfit = result.price;
            }
          }
          
          // CORREÇÃO AUDITORIA 17/12/2025: Detectar tipo de posição mencionado (long/short)
          // Isso permite inferir o side correto:
          // - LONG position: stop/TP fecha com SELL
          // - SHORT position: stop/TP fecha com BUY
          // Se não mencionado, o executeTradingCommand deve consultar a posição atual
          //
          // BUG FIX 17/12/2025: Usar word boundaries (\b) para evitar falsos positivos
          // Exemplo: "along" contém "long" mas NÃO é uma posição long
          // Regex: \blong\b match "long" isolado, não "along", "belong", etc.
          const lowerText = text.toLowerCase();
          const isLongPosition = /\blong\b/.test(lowerText) || /\bcompra(r|do|da)?\b/.test(lowerText);
          const isShortPosition = /\bshort\b/.test(lowerText) || /\bvend(a|er|ido|ida)?\b/.test(lowerText);
          
          if (isLongPosition && !isShortPosition) {
            result.positionType = 'long';
            result.side = 'sell'; // Fechar long = vender
          } else if (isShortPosition && !isLongPosition) {
            result.positionType = 'short';
            result.side = 'buy'; // Fechar short = comprar
          }
          const marketSelection = detectMarketType(text, result.symbol);
          result.marketType = marketSelection.marketType;
          result.marginMode = marketSelection.marginMode;
          // Se ambos ou nenhum, side permanece undefined e será inferido da posição atual
        }

        if (!result.marketType || !result.marginMode) {
          const marketSelection = detectMarketType(text, result.symbol);
          result.marketType = result.marketType ?? marketSelection.marketType;
          result.marginMode = result.marginMode ?? marketSelection.marginMode;
        }

        logger.debug({
          type: result.type,
          confidence: result.confidence,
          amount: result.amount,
          symbol: result.symbol,
          leverage: result.leverage,
          matchedGroups: match.slice(1), // Log dos grupos capturados para debug
        }, 'Comando de trading identificado');

        return result;
      }
    }
  }

  // Se não encontrou match mas tem contexto de trading, pode ser comando ambíguo
  if (hasTradingContext(normalizedText)) {
    result.confidence = 0.3;
  }

  return result;
}

/**
 * Verifica se o texto é um comando de trading
 */
export function isTradingCommand(text: string): boolean {
  const parsed = parseTradingCommand(text);
  return parsed.isTrading && parsed.confidence >= 0.5;
}

/**
 * Obtém descrição amigável do comando
 */
export function getCommandDescription(command: ParsedTradingCommand, language: 'pt' | 'en' = 'pt'): string {
  const descriptions: Record<TradingCommandType, { pt: string; en: string }> = {
    buy: {
      pt: `Comprar ${command.amount || '?'} ${command.symbol || 'BTC'}`,
      en: `Buy ${command.amount || '?'} ${command.symbol || 'BTC'}`,
    },
    sell: {
      pt: `Vender ${command.amount || '?'} ${command.symbol || 'BTC'}`,
      en: `Sell ${command.amount || '?'} ${command.symbol || 'BTC'}`,
    },
    close_position: {
      pt: 'Fechar posição atual',
      en: 'Close current position',
    },
    cancel_order: {
      pt: `Cancelar ordem ${command.orderId || '(especifique o ID)'}`,
      en: `Cancel order ${command.orderId || '(specify ID)'}`,
    },
    status: {
      pt: 'Ver status do trading',
      en: 'View trading status',
    },
    positions: {
      pt: 'Ver posições abertas',
      en: 'View open positions',
    },
    orders: {
      pt: 'Ver ordens ativas',
      en: 'View active orders',
    },
    generate_signal: {
      pt: `Gerar sinal${command.symbol ? ` para ${command.symbol}` : ''}`,
      en: `Generate signal${command.symbol ? ` for ${command.symbol}` : ''}`,
    },
    pause_trading: {
      pt: 'Pausar trading automático',
      en: 'Pause auto trading',
    },
    resume_trading: {
      pt: 'Retomar trading automático',
      en: 'Resume auto trading',
    },
    takeover: {
      pt: 'Assumir controle manual',
      en: 'Take manual control',
    },
    handback: {
      pt: 'Devolver controle para Alice',
      en: 'Hand back control to Alice',
    },
    set_stop_loss: {
      pt: `Definir stop loss em $${command.stopLoss || '?'}`,
      en: `Set stop loss at $${command.stopLoss || '?'}`,
    },
    set_take_profit: {
      pt: `Definir take profit em $${command.takeProfit || '?'}`,
      en: `Set take profit at $${command.takeProfit || '?'}`,
    },
    unknown: {
      pt: 'Comando não reconhecido',
      en: 'Unknown command',
    },
  };

  return descriptions[command.type][language];
}

/**
 * Valida se o comando tem todos os dados necessários para execução
 */
export function validateCommand(command: ParsedTradingCommand): {
  valid: boolean;
  missingFields: string[];
} {
  const missingFields: string[] = [];

  if (command.type === 'buy' || command.type === 'sell') {
    if (!command.amount || command.amount <= 0) {
      missingFields.push('amount');
    }
  }

  if (command.type === 'cancel_order') {
    if (!command.orderId) {
      missingFields.push('orderId');
    }
  }

  if (command.type === 'set_stop_loss' && !command.stopLoss) {
    missingFields.push('stopLoss');
  }

  if (command.type === 'set_take_profit' && !command.takeProfit) {
    missingFields.push('takeProfit');
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

export default {
  parseTradingCommand,
  isTradingCommand,
  getCommandDescription,
  validateCommand,
};
