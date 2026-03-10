import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardDescription } from '@/components/ui/card';
import type { WiseTransfersTabContentProps } from './wise-transfers-tab-types';

type WiseTransfersHeaderProps = Pick<
  WiseTransfersTabContentProps,
  't'
>;

export function WiseTransfersHeader({ t }: WiseTransfersHeaderProps) {
  return (
    <div className="flex justify-between items-center">
      <CardDescription>{t('wise.transfers.subtitle')}</CardDescription>
      <Button data-testid="button-new-transfer">
        <Plus className="h-4 w-4 mr-2" />
        {t('wise.transfers.new')}
      </Button>
    </div>
  );
}
