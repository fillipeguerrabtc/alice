import { TabsContent } from '@/components/ui/tabs';
import { WiseBalanceCapacityCard } from './wise-balance-capacity-card';
import { WiseBalancesGrid } from './wise-balances-grid';
import { WiseBalancesHeader } from './wise-balances-header';
import type { WiseBalancesTabContentProps } from './wise-balances-tab-types';
import { WiseTotalFundsCard } from './wise-total-funds-card';

export function WiseBalancesTabContent({
  balanceCapacityCurrency,
  balanceCapacityResult,
  balances,
  createBalancePending,
  currencies,
  formatCurrency,
  isLoadingBalances,
  locale,
  newBalanceForm,
  onCreateBalance,
  onDeleteBalance,
  onFetchBalanceCapacity,
  onFetchTotalFunds,
  setBalanceCapacityCurrency,
  setNewBalanceForm,
  setShowNewBalanceDialog,
  setTotalFundsCurrency,
  showNewBalanceDialog,
  t,
  totalFundsCurrency,
  totalFundsResult,
}: WiseBalancesTabContentProps) {
  return (
    <TabsContent value="balances" className="space-y-4 mt-6">
      <WiseBalancesHeader
        createBalancePending={createBalancePending}
        currencies={currencies}
        newBalanceForm={newBalanceForm}
        onCreateBalance={onCreateBalance}
        setNewBalanceForm={setNewBalanceForm}
        setShowNewBalanceDialog={setShowNewBalanceDialog}
        showNewBalanceDialog={showNewBalanceDialog}
        t={t}
      />

      <WiseBalancesGrid
        balances={balances}
        formatCurrency={formatCurrency}
        isLoadingBalances={isLoadingBalances}
        locale={locale}
        onDeleteBalance={onDeleteBalance}
        t={t}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <WiseBalanceCapacityCard
          balanceCapacityCurrency={balanceCapacityCurrency}
          balanceCapacityResult={balanceCapacityResult}
          onFetchBalanceCapacity={onFetchBalanceCapacity}
          setBalanceCapacityCurrency={setBalanceCapacityCurrency}
          t={t}
        />
        <WiseTotalFundsCard
          onFetchTotalFunds={onFetchTotalFunds}
          setTotalFundsCurrency={setTotalFundsCurrency}
          t={t}
          totalFundsCurrency={totalFundsCurrency}
          totalFundsResult={totalFundsResult}
        />
      </div>
    </TabsContent>
  );
}
