import { parseLocaleNumberInput } from '@/lib/utils';
import type { TradingOrderForm } from './TradingFormDefaults';

export type TradingOrderPnlEstimate = {
  pnlValue: number;
  pnlPct: number;
};

export type TradingOrderSummary = {
  canSubmitOrder: boolean;
  orderEffectivePrice: number;
  orderLeverageValue: number;
  orderStopLossValue: number | null;
  orderTakeProfitValue: number | null;
  orderStopLossEstimate: TradingOrderPnlEstimate | null;
  orderTakeProfitEstimate: TradingOrderPnlEstimate | null;
};

export function buildTradingOrderSummary(params: {
  orderForm: TradingOrderForm;
  isFuturesMarket: boolean;
  currentPrice: number;
  contractMultiplier: number;
}): TradingOrderSummary {
  const { orderForm, isFuturesMarket, currentPrice, contractMultiplier } = params;
  const orderSizeValue = orderForm.size ? parseLocaleNumberInput(orderForm.size) ?? NaN : NaN;
  const orderFundsValue = orderForm.funds ? parseLocaleNumberInput(orderForm.funds) ?? NaN : NaN;
  const hasOrderSize = Number.isFinite(orderSizeValue) && orderSizeValue > 0;
  const hasOrderFunds = Number.isFinite(orderFundsValue) && orderFundsValue > 0;
  const isOrderMarketBuy = orderForm.orderType === 'market' && orderForm.side === 'buy';
  const canSubmitOrder = isFuturesMarket
    ? hasOrderSize
    : isOrderMarketBuy
      ? hasOrderSize || hasOrderFunds
      : hasOrderSize;

  const orderEffectivePrice = orderForm.orderType === 'limit' && orderForm.price
    ? parseLocaleNumberInput(orderForm.price) ?? currentPrice
    : currentPrice;
  const orderLeverageValue = parseLocaleNumberInput(orderForm.leverage) ?? 1;
  const orderStopLossValue = parseLocaleNumberInput(orderForm.stopLoss);
  const orderTakeProfitValue = parseLocaleNumberInput(orderForm.takeProfit);
  const orderEffectiveQuantity = hasOrderSize
    ? (isFuturesMarket ? orderSizeValue * contractMultiplier : orderSizeValue)
    : 0;
  const orderDirection = orderForm.side === 'buy' ? 1 : -1;

  const estimateOrderPnl = (targetPrice: number | null): TradingOrderPnlEstimate | null => {
    if (
      !targetPrice
      || targetPrice <= 0
      || !Number.isFinite(orderEffectivePrice)
      || orderEffectivePrice <= 0
      || orderEffectiveQuantity <= 0
    ) {
      return null;
    }
    const pnlValue = (targetPrice - orderEffectivePrice) * orderEffectiveQuantity * orderDirection;
    const marginBase = isFuturesMarket
      ? (orderEffectivePrice * orderEffectiveQuantity) / Math.max(orderLeverageValue, 1)
      : orderEffectivePrice * orderEffectiveQuantity;
    const pnlPct = marginBase > 0 ? (pnlValue / marginBase) * 100 : 0;
    return { pnlValue, pnlPct };
  };

  return {
    canSubmitOrder,
    orderEffectivePrice,
    orderLeverageValue,
    orderStopLossValue,
    orderTakeProfitValue,
    orderStopLossEstimate: estimateOrderPnl(orderStopLossValue),
    orderTakeProfitEstimate: estimateOrderPnl(orderTakeProfitValue),
  };
}
