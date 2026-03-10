import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardDescription } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import { WiseTransfersActionsCard } from './wise-transfers-actions-card';
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
      <div className="flex justify-between items-center">
        <CardDescription>{t('wise.transfers.subtitle')}</CardDescription>
        <Button data-testid="button-new-transfer">
          <Plus className="h-4 w-4 mr-2" />
          {t('wise.transfers.new')}
        </Button>
      </div>

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
