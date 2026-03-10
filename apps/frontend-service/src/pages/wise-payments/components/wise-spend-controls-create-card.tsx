import { Plus } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { WiseCurrencyOption, WiseSpendControlForm } from './wise-spend-controls-tab-types';

type WiseSpendControlsCreateCardProps = {
  createSpendControlPending: boolean;
  currencies: WiseCurrencyOption[];
  onCreateSpendControl: () => void;
  setSpendControlForm: (updater: (prev: WiseSpendControlForm) => WiseSpendControlForm) => void;
  spendControlForm: WiseSpendControlForm;
  t: TFunction;
};

export function WiseSpendControlsCreateCard({
  createSpendControlPending,
  currencies,
  onCreateSpendControl,
  setSpendControlForm,
  spendControlForm,
  t,
}: WiseSpendControlsCreateCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.spendControls.new')}</CardTitle>
        <CardDescription>{t('wise.spendControls.newSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>{t('wise.spendControls.name')}</Label>
            <Input
              value={spendControlForm.name}
              onChange={(event) => setSpendControlForm((prev) => ({ ...prev, name: event.target.value }))}
              data-testid="input-spend-name"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('wise.spendControls.currency')}</Label>
            <Select
              value={spendControlForm.currency}
              onValueChange={(value) => setSpendControlForm((prev) => ({ ...prev, currency: value }))}
            >
              <SelectTrigger data-testid="select-spend-currency">
                <SelectValue placeholder={t('common.select')} />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((currency) => (
                  <SelectItem key={currency.code} value={currency.code}>
                    {currency.code} - {currency.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('wise.spendControls.amount')}</Label>
            <Input
              value={spendControlForm.maxAmount}
              onChange={(event) => setSpendControlForm((prev) => ({ ...prev, maxAmount: event.target.value }))}
              data-testid="input-spend-amount"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('wise.spendControls.period')}</Label>
            <Select
              value={spendControlForm.period}
              onValueChange={(value) => setSpendControlForm((prev) => ({ ...prev, period: value }))}
            >
              <SelectTrigger data-testid="select-spend-period">
                <SelectValue placeholder={t('common.select')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DAILY">{t('wise.spendControls.daily')}</SelectItem>
                <SelectItem value="WEEKLY">{t('wise.spendControls.weekly')}</SelectItem>
                <SelectItem value="MONTHLY">{t('wise.spendControls.monthly')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={onCreateSpendControl} disabled={createSpendControlPending} data-testid="button-create-spend-control">
          <Plus className="h-4 w-4 mr-2" />
          {t('wise.spendControls.create')}
        </Button>
      </CardContent>
    </Card>
  );
}
