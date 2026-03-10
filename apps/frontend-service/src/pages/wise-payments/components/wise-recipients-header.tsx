import { Plus } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CurrencyOption } from './wise-recipients-tab-types';

type WiseRecipientsHeaderProps = {
  currencies: CurrencyOption[];
  setShowNewRecipientDialog: (open: boolean) => void;
  showNewRecipientDialog: boolean;
  t: TFunction;
};

export function WiseRecipientsHeader({
  currencies,
  setShowNewRecipientDialog,
  showNewRecipientDialog,
  t,
}: WiseRecipientsHeaderProps) {
  return (
    <div className="flex justify-between items-center">
      <CardDescription>{t('wise.recipients.subtitle')}</CardDescription>
      <Dialog open={showNewRecipientDialog} onOpenChange={setShowNewRecipientDialog}>
        <DialogTrigger asChild>
          <Button data-testid="button-new-recipient">
            <Plus className="h-4 w-4 mr-2" />
            {t('wise.recipients.new')}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('wise.recipients.new')}</DialogTitle>
            <DialogDescription>{t('wise.recipients.subtitle')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('wise.recipients.name')}</Label>
              <Input placeholder="John Doe" data-testid="input-recipient-name" />
            </div>
            <div className="space-y-2">
              <Label>{t('wise.recipients.currency')}</Label>
              <Select>
                <SelectTrigger data-testid="select-recipient-currency">
                  <SelectValue placeholder={t('wise.recipients.currency')} />
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
              <Label>{t('wise.recipients.iban')}</Label>
              <Input placeholder="PT50..." data-testid="input-recipient-iban" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewRecipientDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button data-testid="button-save-recipient">
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
