import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { WiseBalance } from './wise-payments-types';

type SpendControlCurrencyForm = {
  currency: string;
};

type UseWiseSpendControlDefaultCurrencyOptions<TForm extends SpendControlCurrencyForm> = {
  balances: WiseBalance[];
  setSpendControlForm: Dispatch<SetStateAction<TForm>>;
  spendControlForm: TForm;
};

export function useWiseSpendControlDefaultCurrency<TForm extends SpendControlCurrencyForm>(
  options: UseWiseSpendControlDefaultCurrencyOptions<TForm>
) {
  const { balances, setSpendControlForm, spendControlForm } = options;

  useEffect(() => {
    if (spendControlForm.currency) return;
    const firstCurrency = balances[0]?.currency;
    if (!firstCurrency) return;
    setSpendControlForm((previous) => ({ ...previous, currency: firstCurrency }));
  }, [balances, setSpendControlForm, spendControlForm.currency]);
}
