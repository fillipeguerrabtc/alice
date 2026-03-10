import { Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type WiseSpendControlsDeleteCardProps = {
  deleteSpendControlPending: boolean;
  onDeleteSpendControl: () => void;
  setSpendControlDeleteId: (value: string) => void;
  spendControlDeleteId: string;
  t: TFunction;
};

export function WiseSpendControlsDeleteCard({
  deleteSpendControlPending,
  onDeleteSpendControl,
  setSpendControlDeleteId,
  spendControlDeleteId,
  t,
}: WiseSpendControlsDeleteCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.spendControls.deleteTitle')}</CardTitle>
        <CardDescription>{t('wise.spendControls.deleteSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={spendControlDeleteId}
          onChange={(event) => setSpendControlDeleteId(event.target.value)}
          placeholder={t('wise.spendControls.ruleId')}
          data-testid="input-spend-delete"
        />
        <Button
          variant="destructive"
          onClick={onDeleteSpendControl}
          disabled={deleteSpendControlPending}
          data-testid="button-delete-spend-control"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          {t('wise.spendControls.delete')}
        </Button>
      </CardContent>
    </Card>
  );
}
