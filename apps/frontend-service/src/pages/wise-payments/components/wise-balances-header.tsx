import { CardDescription } from '@/components/ui/card';
import { WiseBalancesNewBalanceDialog } from './wise-balances-new-balance-dialog';
import type { WiseBalancesTabContentProps } from './wise-balances-tab-types';

type WiseBalancesHeaderProps = Pick<
  WiseBalancesTabContentProps,
  | 'createBalancePending'
  | 'currencies'
  | 'newBalanceForm'
  | 'onCreateBalance'
  | 'setNewBalanceForm'
  | 'setShowNewBalanceDialog'
  | 'showNewBalanceDialog'
  | 't'
>;

export function WiseBalancesHeader({
  createBalancePending,
  currencies,
  newBalanceForm,
  onCreateBalance,
  setNewBalanceForm,
  setShowNewBalanceDialog,
  showNewBalanceDialog,
  t,
}: WiseBalancesHeaderProps) {
  return (
    <div className="flex justify-between items-center">
      <CardDescription>{t('wise.balances.subtitle')}</CardDescription>
      <WiseBalancesNewBalanceDialog
        createBalancePending={createBalancePending}
        currencies={currencies}
        newBalanceForm={newBalanceForm}
        onCreateBalance={onCreateBalance}
        setNewBalanceForm={setNewBalanceForm}
        setShowNewBalanceDialog={setShowNewBalanceDialog}
        showNewBalanceDialog={showNewBalanceDialog}
        t={t}
      />
    </div>
  );
}
