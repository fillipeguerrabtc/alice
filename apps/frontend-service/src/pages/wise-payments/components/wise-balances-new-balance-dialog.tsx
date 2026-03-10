import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { WiseBalancesNewBalanceFormFields } from './wise-balances-new-balance-form-fields';
import type { WiseBalancesTabContentProps } from './wise-balances-tab-types';

type WiseBalancesNewBalanceDialogProps = Pick<
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

export function WiseBalancesNewBalanceDialog({
  createBalancePending,
  currencies,
  newBalanceForm,
  onCreateBalance,
  setNewBalanceForm,
  setShowNewBalanceDialog,
  showNewBalanceDialog,
  t,
}: WiseBalancesNewBalanceDialogProps) {
  return (
    <Dialog open={showNewBalanceDialog} onOpenChange={setShowNewBalanceDialog}>
      <DialogTrigger asChild>
        <Button data-testid="button-new-balance">
          <Plus className="h-4 w-4 mr-2" />
          {t('wise.balances.new')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('wise.balances.new')}</DialogTitle>
          <DialogDescription>{t('wise.balances.newDescription')}</DialogDescription>
        </DialogHeader>

        <WiseBalancesNewBalanceFormFields
          currencies={currencies}
          newBalanceForm={newBalanceForm}
          setNewBalanceForm={setNewBalanceForm}
          t={t}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => setShowNewBalanceDialog(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onCreateBalance} disabled={createBalancePending} data-testid="button-save-balance">
            {createBalancePending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
