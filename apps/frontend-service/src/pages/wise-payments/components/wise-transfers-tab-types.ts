import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';

export type WiseTransfer = {
  id: number;
  targetAccount: number;
  status: string;
  reference: string;
  created: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceValue: number;
  targetValue: number;
};

export type WiseTransfersTabContentProps = {
  formatCurrency: (value: number, currency: string, locale: string) => string;
  formatDate: (value: string, options: { locale?: string; timeZone?: string }) => string;
  getStatusBadge: (status: string) => ReactNode;
  isLoadingTransfers: boolean;
  locale: string;
  onCancelTransfer: () => void;
  onFundTransfer: () => void;
  setTransferActionId: (value: string) => void;
  t: TFunction;
  timeZone: string;
  transferActionId: string;
  transferActionResult: string | null;
  transfers: WiseTransfer[];
};
