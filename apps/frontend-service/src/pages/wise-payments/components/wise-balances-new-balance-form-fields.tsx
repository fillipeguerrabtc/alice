import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CurrencyOption, NewBalanceForm } from './wise-balances-tab-types';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';

type WiseBalancesNewBalanceFormFieldsProps = {
  currencies: CurrencyOption[];
  newBalanceForm: NewBalanceForm;
  setNewBalanceForm: Dispatch<SetStateAction<NewBalanceForm>>;
  t: TFunction;
};

export function WiseBalancesNewBalanceFormFields({
  currencies,
  newBalanceForm,
  setNewBalanceForm,
  t,
}: WiseBalancesNewBalanceFormFieldsProps) {
  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label>{t('wise.balances.currency')}</Label>
        <Select
          value={newBalanceForm.currency}
          onValueChange={(value: string) => setNewBalanceForm((prev) => ({ ...prev, currency: value }))}
        >
          <SelectTrigger data-testid="select-balance-currency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {currencies.map((curr) => (
              <SelectItem key={curr.code} value={curr.code}>
                {curr.code} - {curr.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>{t('wise.balances.type')}</Label>
        <Select
          value={newBalanceForm.type}
          onValueChange={(value: 'STANDARD' | 'SAVINGS') => setNewBalanceForm((prev) => ({ ...prev, type: value }))}
        >
          <SelectTrigger data-testid="select-balance-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="STANDARD">{t('wise.balances.standard')}</SelectItem>
            <SelectItem value="SAVINGS">{t('wise.balances.savings')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {newBalanceForm.type === 'SAVINGS' && (
        <div className="space-y-2">
          <Label>{t('wise.balances.name')}</Label>
          <Input
            value={newBalanceForm.name}
            onChange={(event) =>
              setNewBalanceForm((prev) => ({ ...prev, name: event.target.value }))
            }
            placeholder={t('wise.balances.namePlaceholder')}
            data-testid="input-balance-name"
          />
        </div>
      )}
    </div>
  );
}
