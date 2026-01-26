/**
 * OrderBookViz - Visualização do Order Book em Tempo Real
 * 
 * Componente enterprise-grade para exibir profundidade de mercado.
 * Mostra ordens de compra (bids) e venda (asks) com barras de profundidade.
 * 
 * Features:
 * - Bids (verde) à esquerda, Asks (vermelho) à direita
 * - Barras de profundidade proporcionais ao volume
 * - Spread destacado no centro
 * - Atualização em tempo real via WebSocket
 * - Agrupamento de preços configurável
 * - Animações suaves para atualizações
 * 
 * Regra 6 - SEM MOCKS: Dados reais da API KuCoin
 * Regra 8 - TypeScript strict
 * Regra 13 - i18n PT-BR/EN
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn, formatNumber } from '@/lib/utils';
import {
  Layers,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

// ============================================================================
// TIPOS
// ============================================================================

export interface OrderBookEntry {
  price: string;
  size: string;
  sequence: number;
}

export interface OrderBookData {
  sequence: number;
  symbol: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  timestamp: number;
}

export interface OrderBookVizProps {
  data: OrderBookData | null;
  symbol: string;
  currentPrice?: number;
  isLoading?: boolean;
  depth?: number;
  precision?: number;
  locale?: string;
}

interface ProcessedLevel {
  price: number;
  size: number;
  total: number;
  percentage: number;
}

// ============================================================================
// CONSTANTES
// ============================================================================

const COLORS = {
  bid: {
    bar: 'rgba(34, 197, 94, 0.2)',
    text: 'text-green-500',
    border: 'border-green-500',
  },
  ask: {
    bar: 'rgba(239, 68, 68, 0.2)',
    text: 'text-red-500',
    border: 'border-red-500',
  },
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Formata preço para exibição
 */
function formatPrice(value: number, precision: number, locale: string): string {
  return formatNumber(value, locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

/**
 * Formata tamanho para exibição
 */
function formatSize(value: number, locale: string): string {
  if (value >= 1000) {
    return `${formatNumber(value / 1000, locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}K`;
  }
  return formatNumber(value, locale, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

/**
 * Processa entradas do order book
 */
function processLevels(
  entries: OrderBookEntry[],
  maxTotal: number,
  depth: number
): ProcessedLevel[] {
  let cumulative = 0;
  
  return entries.slice(0, depth).map((entry) => {
    const price = parseFloat(entry.price);
    const size = parseFloat(entry.size);
    cumulative += size;
    
    return {
      price,
      size,
      total: cumulative,
      percentage: maxTotal > 0 ? (cumulative / maxTotal) * 100 : 0,
    };
  });
}

// ============================================================================
// COMPONENTE LEVEL ROW
// ============================================================================

interface LevelRowProps {
  level: ProcessedLevel;
  type: 'bid' | 'ask';
  precision: number;
  isHighlighted?: boolean;
  locale: string;
}

function LevelRow({ level, type, precision, isHighlighted, locale }: LevelRowProps) {
  const colors = COLORS[type];
  
  return (
    <div
      className={cn(
        'relative flex items-center justify-between px-2 py-0.5 text-xs font-mono',
        'hover:bg-muted/50 transition-colors',
        isHighlighted && 'bg-muted/30'
      )}
    >
      {/* Background bar */}
      <div
        className="absolute inset-y-0 right-0 transition-all duration-200"
        style={{
          width: `${level.percentage}%`,
          backgroundColor: colors.bar,
        }}
      />
      
      {/* Content */}
      <div className="relative z-10 flex items-center justify-between w-full">
        <span className={cn('tabular-nums', colors.text)}>
          {formatPrice(level.price, precision, locale)}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {formatSize(level.size, locale)}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {formatSize(level.total, locale)}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export function OrderBookViz({
  data,
  symbol,
  currentPrice,
  isLoading = false,
  depth = 15,
  precision = 2,
  locale,
}: OrderBookVizProps) {
  const { t } = useTranslation();
  const resolvedLocale = locale?.trim() || 'pt-BR';
  
  // Processar dados do order book
  // CORREÇÃO 19/12/2025: Remover maxTotal não utilizado (no-unused-vars)
  const { bids, asks, spread, spreadPercentage } = useMemo(() => {
    if (!data) {
      return {
        bids: [],
        asks: [],
        spread: 0,
        spreadPercentage: 0,
        maxTotal: 0,
      };
    }
    
    // Calcular totais acumulados
    const bidTotals = data.bids
      .slice(0, depth)
      .reduce((acc, b) => acc + parseFloat(b.size), 0);
    const askTotals = data.asks
      .slice(0, depth)
      .reduce((acc, a) => acc + parseFloat(a.size), 0);
    
    const maxTotal = Math.max(bidTotals, askTotals);
    
    // Processar níveis
    const processedBids = processLevels(data.bids, maxTotal, depth);
    const processedAsks = processLevels(data.asks, maxTotal, depth);
    
    // Calcular spread
    const bestBid = processedBids[0]?.price || 0;
    const bestAsk = processedAsks[0]?.price || 0;
    const spreadValue = bestAsk - bestBid;
    const spreadPct = bestBid > 0 ? (spreadValue / bestBid) * 100 : 0;
    
    return {
      bids: processedBids,
      asks: processedAsks,
      spread: spreadValue,
      spreadPercentage: spreadPct,
      maxTotal,
    };
  }, [data, depth]);
  
  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }
  
  // Empty state
  if (!data || bids.length === 0 || asks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            {t('trading.orderbook.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[400px]">
          <p className="text-muted-foreground">{t('trading.orderbook.noData')}</p>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            {t('trading.orderbook.title')}
          </CardTitle>
          
          <Badge variant="outline" className="font-mono">
            {symbol}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        {/* Header */}
        <div className="grid grid-cols-3 px-2 py-1 text-xs text-muted-foreground border-b">
          <span>{t('trading.orderbook.price')}</span>
          <span className="text-center">{t('trading.orderbook.size')}</span>
          <span className="text-right">{t('trading.orderbook.total')}</span>
        </div>
        
        {/* Asks (sells) - reversed order */}
        <div className="max-h-[200px] overflow-y-auto">
          {[...asks].reverse().map((level, index) => (
            <LevelRow
              key={`ask-${index}`}
              level={level}
              type="ask"
              precision={precision}
              locale={resolvedLocale}
            />
          ))}
        </div>
        
        {/* Spread section */}
        <div className="flex items-center justify-between px-2 py-2 bg-muted/50 border-y">
          <div className="flex items-center gap-2">
            {currentPrice && (
              <>
                {spread >= 0 ? (
                  <ArrowUp className="h-4 w-4 text-green-500" />
                ) : (
                  <ArrowDown className="h-4 w-4 text-red-500" />
                )}
                <span className="text-lg font-bold font-mono">
                  ${formatPrice(currentPrice, precision, resolvedLocale)}
                </span>
              </>
            )}
          </div>
          
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t('trading.orderbook.spread')}:</span>
            <span className="font-mono">${formatPrice(spread, precision, resolvedLocale)}</span>
            <Badge variant="secondary" className="text-xs">
              {formatNumber(spreadPercentage, resolvedLocale, {
                minimumFractionDigits: 3,
                maximumFractionDigits: 3,
              })}
              %
            </Badge>
          </div>
        </div>
        
        {/* Bids (buys) */}
        <div className="max-h-[200px] overflow-y-auto">
          {bids.map((level, index) => (
            <LevelRow
              key={`bid-${index}`}
              level={level}
              type="bid"
              precision={precision}
              locale={resolvedLocale}
            />
          ))}
        </div>
        
        {/* Footer stats */}
        <div className="flex items-center justify-between px-2 py-2 border-t text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{t('trading.orderbook.bidTotal')}:</span>
            <span className="font-mono text-green-500">
              {formatSize(bids[bids.length - 1]?.total || 0, resolvedLocale)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{t('trading.orderbook.askTotal')}:</span>
            <span className="font-mono text-red-500">
              {formatSize(asks[asks.length - 1]?.total || 0, resolvedLocale)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default OrderBookViz;
