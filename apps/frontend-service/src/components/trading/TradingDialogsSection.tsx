import type { ComponentProps } from 'react';
import { OcoOrderForm } from './OcoOrderForm';
import { TradingNewOrderDialog } from './TradingNewOrderDialog';
import { TradingNewSignalDialog } from './TradingNewSignalDialog';
import { TradingPostmortemTrainingDialog } from './TradingPostmortemTrainingDialog';
import { TradingReviewOrderDialog } from './TradingReviewOrderDialog';
import { TradingRiskConfigDialog } from './TradingRiskConfigDialog';

type TradingDialogsSectionProps = {
  newOrderDialogProps: ComponentProps<typeof TradingNewOrderDialog>;
  newSignalDialogProps: ComponentProps<typeof TradingNewSignalDialog>;
  ocoOrderDialogProps: ComponentProps<typeof OcoOrderForm>;
  postmortemTrainingDialogProps: ComponentProps<typeof TradingPostmortemTrainingDialog>;
  reviewOrderDialogProps: ComponentProps<typeof TradingReviewOrderDialog>;
  riskConfigDialogProps: ComponentProps<typeof TradingRiskConfigDialog>;
};

export function TradingDialogsSection({
  newOrderDialogProps,
  newSignalDialogProps,
  ocoOrderDialogProps,
  postmortemTrainingDialogProps,
  reviewOrderDialogProps,
  riskConfigDialogProps,
}: TradingDialogsSectionProps) {
  return (
    <>
      <TradingNewOrderDialog {...newOrderDialogProps} />
      <OcoOrderForm {...ocoOrderDialogProps} />
      <TradingReviewOrderDialog {...reviewOrderDialogProps} />
      <TradingRiskConfigDialog {...riskConfigDialogProps} />
      <TradingPostmortemTrainingDialog {...postmortemTrainingDialogProps} />
      <TradingNewSignalDialog {...newSignalDialogProps} />
    </>
  );
}
