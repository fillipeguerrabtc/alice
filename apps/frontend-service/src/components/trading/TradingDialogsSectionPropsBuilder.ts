import type {
  DialogsSectionProps,
  NewOrderDialogProps,
  NewSignalDialogProps,
  OcoOrderDialogProps,
  PostmortemTrainingDialogProps,
  ReviewOrderDialogProps,
  RiskConfigDialogProps,
} from './TradingSectionPropsBuilderTypes';

type BuildTradingDialogsSectionPropsOptions = {
  availableNamespaces: PostmortemTrainingDialogProps['availableNamespaces'];
  canSubmitPostmortemTraining: PostmortemTrainingDialogProps['canSubmit'];
  canSubmitOrder: NewOrderDialogProps['canSubmitOrder'];
  currentPrice: NewOrderDialogProps['currentPrice'];
  defaultSymbol: NewOrderDialogProps['defaultSymbol'];
  highPrice: NewOrderDialogProps['highPrice'];
  isFuturesMarket: NewOrderDialogProps['isFuturesMarket'];
  isSubmittingNewOrder: NewOrderDialogProps['isSubmitting'];
  isSubmittingNewSignal: NewSignalDialogProps['isSubmitting'];
  isSubmittingPostmortemTraining: PostmortemTrainingDialogProps['isSubmitting'];
  isSubmittingRiskConfig: RiskConfigDialogProps['isSubmitting'];
  isApprovingReviewOrder: ReviewOrderDialogProps['isApproving'];
  isUpdatingReviewOrder: ReviewOrderDialogProps['isUpdating'];
  locale: NewOrderDialogProps['locale'];
  lowPrice: NewOrderDialogProps['lowPrice'];
  marginMode: OcoOrderDialogProps['marginMode'];
  marketType: OcoOrderDialogProps['marketType'];
  onCancelNewOrder: NewOrderDialogProps['onCancel'];
  onCancelPostmortemTraining: PostmortemTrainingDialogProps['onCancel'];
  onCancelRiskConfig: RiskConfigDialogProps['onCancel'];
  onCloseReviewOrder: ReviewOrderDialogProps['onClose'];
  onApproveAndExecuteReviewOrder: ReviewOrderDialogProps['onApproveAndExecute'];
  onConfidenceChange: NewSignalDialogProps['onConfidenceChange'];
  onNamespaceChange: PostmortemTrainingDialogProps['onNamespaceChange'];
  onOpenChangeNewOrder: NewOrderDialogProps['onOpenChange'];
  onOpenChangeNewSignal: NewSignalDialogProps['onOpenChange'];
  onOpenChangeOco: OcoOrderDialogProps['onOpenChange'];
  onOpenChangePostmortemTraining: PostmortemTrainingDialogProps['onOpenChange'];
  onOpenChangeReviewOrder: ReviewOrderDialogProps['onOpenChange'];
  onOpenChangeRiskConfig: RiskConfigDialogProps['onOpenChange'];
  onPatchOrderForm: NewOrderDialogProps['onPatchOrderForm'];
  onPatchRiskForm: RiskConfigDialogProps['onPatchForm'];
  onReasoningChange: NewSignalDialogProps['onReasoningChange'];
  onSaveAdjustmentsReviewOrder: ReviewOrderDialogProps['onSaveAdjustments'];
  onSignalTypeChange: NewSignalDialogProps['onSignalTypeChange'];
  onSizeChangeNewOrder: NewOrderDialogProps['onSizeChange'];
  onSubmitNewOrder: NewOrderDialogProps['onSubmit'];
  onSubmitNewSignal: NewSignalDialogProps['onSubmit'];
  onSubmitPostmortemTraining: PostmortemTrainingDialogProps['onSubmit'];
  onSubmitRiskConfig: RiskConfigDialogProps['onSubmit'];
  onUpdateFieldReviewOrder: ReviewOrderDialogProps['onUpdateField'];
  onUsdtChangeNewOrder: NewOrderDialogProps['onUsdtChange'];
  openNewOrderDialog: NewOrderDialogProps['open'];
  openNewSignalDialog: NewSignalDialogProps['open'];
  openOcoOrderDialog: OcoOrderDialogProps['open'];
  openPostmortemTrainingDialog: PostmortemTrainingDialogProps['open'];
  openReviewOrderDialog: ReviewOrderDialogProps['open'];
  openRiskConfigDialog: RiskConfigDialogProps['open'];
  orderEffectivePrice: NewOrderDialogProps['orderEffectivePrice'];
  orderForm: NewOrderDialogProps['orderForm'];
  orderLeverageValue: NewOrderDialogProps['orderLeverageValue'];
  orderStopLossEstimate: NewOrderDialogProps['orderStopLossEstimate'];
  orderStopLossValue: NewOrderDialogProps['orderStopLossValue'];
  orderTakeProfitEstimate: NewOrderDialogProps['orderTakeProfitEstimate'];
  orderTakeProfitValue: NewOrderDialogProps['orderTakeProfitValue'];
  priceChange: NewOrderDialogProps['priceChange'];
  priceChangePercent: NewOrderDialogProps['priceChangePercent'];
  reviewOrderForm: ReviewOrderDialogProps['form'];
  reviewOrderHasTarget: ReviewOrderDialogProps['hasTarget'];
  riskForm: RiskConfigDialogProps['riskForm'];
  riskMaxLeverage: NewOrderDialogProps['riskMaxLeverage'];
  selectedMarketType: NewOrderDialogProps['selectedMarketType'];
  selectedNamespaceId: PostmortemTrainingDialogProps['selectedNamespaceId'];
  selectedSymbol: NewOrderDialogProps['selectedSymbol'];
  signalForm: NewSignalDialogProps['signalForm'];
  signalTypeOptions: NewSignalDialogProps['signalTypeOptions'];
  symbolForOcoDialog: OcoOrderDialogProps['symbol'];
  symbolOptions: RiskConfigDialogProps['symbolOptions'];
  t: NewOrderDialogProps['t'];
  volumeOf24h: NewOrderDialogProps['volumeOf24h'];
  wsEnabled: NewOrderDialogProps['wsEnabled'];
};

export function buildTradingDialogsSectionProps({
  availableNamespaces,
  canSubmitPostmortemTraining,
  canSubmitOrder,
  currentPrice,
  defaultSymbol,
  highPrice,
  isApprovingReviewOrder,
  isFuturesMarket,
  isSubmittingNewOrder,
  isSubmittingNewSignal,
  isSubmittingPostmortemTraining,
  isSubmittingRiskConfig,
  isUpdatingReviewOrder,
  locale,
  lowPrice,
  marginMode,
  marketType,
  onCancelNewOrder,
  onCancelPostmortemTraining,
  onCancelRiskConfig,
  onCloseReviewOrder,
  onApproveAndExecuteReviewOrder,
  onConfidenceChange,
  onNamespaceChange,
  onOpenChangeNewOrder,
  onOpenChangeNewSignal,
  onOpenChangeOco,
  onOpenChangePostmortemTraining,
  onOpenChangeReviewOrder,
  onOpenChangeRiskConfig,
  onPatchOrderForm,
  onPatchRiskForm,
  onReasoningChange,
  onSaveAdjustmentsReviewOrder,
  onSignalTypeChange,
  onSizeChangeNewOrder,
  onSubmitNewOrder,
  onSubmitNewSignal,
  onSubmitPostmortemTraining,
  onSubmitRiskConfig,
  onUpdateFieldReviewOrder,
  onUsdtChangeNewOrder,
  openNewOrderDialog,
  openNewSignalDialog,
  openOcoOrderDialog,
  openPostmortemTrainingDialog,
  openReviewOrderDialog,
  openRiskConfigDialog,
  orderEffectivePrice,
  orderForm,
  orderLeverageValue,
  orderStopLossEstimate,
  orderStopLossValue,
  orderTakeProfitEstimate,
  orderTakeProfitValue,
  priceChange,
  priceChangePercent,
  reviewOrderForm,
  reviewOrderHasTarget,
  riskForm,
  riskMaxLeverage,
  selectedMarketType,
  selectedNamespaceId,
  selectedSymbol,
  signalForm,
  signalTypeOptions,
  symbolForOcoDialog,
  symbolOptions,
  t,
  volumeOf24h,
  wsEnabled,
}: BuildTradingDialogsSectionPropsOptions): { dialogsSectionProps: DialogsSectionProps } {
  const newOrderDialogProps: NewOrderDialogProps = {
    canSubmitOrder,
    currentPrice,
    defaultSymbol,
    highPrice,
    isFuturesMarket,
    isSubmitting: isSubmittingNewOrder,
    locale,
    lowPrice,
    onCancel: onCancelNewOrder,
    onOpenChange: onOpenChangeNewOrder,
    onPatchOrderForm,
    onSizeChange: onSizeChangeNewOrder,
    onSubmit: onSubmitNewOrder,
    onUsdtChange: onUsdtChangeNewOrder,
    open: openNewOrderDialog,
    orderEffectivePrice,
    orderForm,
    orderLeverageValue,
    orderStopLossEstimate,
    orderStopLossValue,
    orderTakeProfitEstimate,
    orderTakeProfitValue,
    priceChange,
    priceChangePercent,
    riskMaxLeverage,
    selectedMarketType,
    selectedSymbol,
    t,
    volumeOf24h,
    wsEnabled,
  };
  const ocoOrderDialogProps: OcoOrderDialogProps = {
    currentPrice,
    marginMode,
    marketType,
    onOpenChange: onOpenChangeOco,
    open: openOcoOrderDialog,
    symbol: symbolForOcoDialog,
  };
  const reviewOrderDialogProps: ReviewOrderDialogProps = {
    form: reviewOrderForm,
    hasTarget: reviewOrderHasTarget,
    isApproving: isApprovingReviewOrder,
    isUpdating: isUpdatingReviewOrder,
    onApproveAndExecute: onApproveAndExecuteReviewOrder,
    onClose: onCloseReviewOrder,
    onOpenChange: onOpenChangeReviewOrder,
    onSaveAdjustments: onSaveAdjustmentsReviewOrder,
    onUpdateField: onUpdateFieldReviewOrder,
    open: openReviewOrderDialog,
  };
  const riskConfigDialogProps: RiskConfigDialogProps = {
    isSubmitting: isSubmittingRiskConfig,
    onCancel: onCancelRiskConfig,
    onOpenChange: onOpenChangeRiskConfig,
    onPatchForm: onPatchRiskForm,
    onSubmit: onSubmitRiskConfig,
    open: openRiskConfigDialog,
    riskForm,
    symbolOptions,
    t,
  };
  const postmortemTrainingDialogProps: PostmortemTrainingDialogProps = {
    availableNamespaces,
    canSubmit: canSubmitPostmortemTraining,
    isSubmitting: isSubmittingPostmortemTraining,
    onCancel: onCancelPostmortemTraining,
    onNamespaceChange,
    onOpenChange: onOpenChangePostmortemTraining,
    onSubmit: onSubmitPostmortemTraining,
    open: openPostmortemTrainingDialog,
    selectedNamespaceId,
    t,
  };
  const newSignalDialogProps: NewSignalDialogProps = {
    isSubmitting: isSubmittingNewSignal,
    onConfidenceChange,
    onOpenChange: onOpenChangeNewSignal,
    onReasoningChange,
    onSignalTypeChange,
    onSubmit: onSubmitNewSignal,
    open: openNewSignalDialog,
    signalForm,
    signalTypeOptions,
    t,
  };

  return {
    dialogsSectionProps: {
      newOrderDialogProps,
      newSignalDialogProps,
      ocoOrderDialogProps,
      postmortemTrainingDialogProps,
      reviewOrderDialogProps,
      riskConfigDialogProps,
    },
  };
}
