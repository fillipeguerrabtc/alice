import { TabsContent } from '@/components/ui/tabs';
import { WiseTransfersActionsCard } from './wise-transfers-actions-card';
import { WiseTransfersHeader } from './wise-transfers-header';
import { WiseTransfersListCard } from './wise-transfers-list-card';
import type { WiseTransfersTabContentProps } from './wise-transfers-tab-types';

export function WiseTransfersTabContent({
  formatCurrency,
  formatDate,
  getStatusBadge,
  isLoadingTransfers,
  locale,
  onCancelTransfer,
  onFundTransfer,
  setTransferActionId,
  t,
  timeZone,
  transferActionId,
  transferActionResult,
  transfers,
}: WiseTransfersTabContentProps) {
  return (
    <TabsContent value="transfers" className="space-y-4 mt-6">
      <WiseTransfersHeader t={t} />

      <WiseTransfersListCard
        formatCurrency={formatCurrency}
        formatDate={formatDate}
        getStatusBadge={getStatusBadge}
        isLoadingTransfers={isLoadingTransfers}
        locale={locale}
        t={t}
        timeZone={timeZone}
        transfers={transfers}
      />

      <WiseTransfersActionsCard
        onCancelTransfer={onCancelTransfer}
        onFundTransfer={onFundTransfer}
        setTransferActionId={setTransferActionId}
        t={t}
        transferActionId={transferActionId}
        transferActionResult={transferActionResult}
      />
    </TabsContent>
  );
}
