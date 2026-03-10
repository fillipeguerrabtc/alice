import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WiseSpendControlAssignment } from './wise-spend-controls-tab-types';

type WiseSpendControlsAssignCardProps = {
  assignSpendControlPending: boolean;
  onAssignSpendControl: (assign: 'assign' | 'unassign') => void;
  setSpendControlAssignment: (updater: (prev: WiseSpendControlAssignment) => WiseSpendControlAssignment) => void;
  spendControlAssignment: WiseSpendControlAssignment;
  t: TFunction;
  unassignSpendControlPending: boolean;
};

export function WiseSpendControlsAssignCard({
  assignSpendControlPending,
  onAssignSpendControl,
  setSpendControlAssignment,
  spendControlAssignment,
  t,
  unassignSpendControlPending,
}: WiseSpendControlsAssignCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.spendControls.assignTitle')}</CardTitle>
        <CardDescription>{t('wise.spendControls.assignSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t('wise.spendControls.ruleId')}</Label>
            <Input
              value={spendControlAssignment.ruleId}
              onChange={(event) => setSpendControlAssignment((prev) => ({ ...prev, ruleId: event.target.value }))}
              data-testid="input-spend-rule-id"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('wise.spendControls.cardToken')}</Label>
            <Input
              value={spendControlAssignment.cardToken}
              onChange={(event) => setSpendControlAssignment((prev) => ({ ...prev, cardToken: event.target.value }))}
              data-testid="input-spend-card-token"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => onAssignSpendControl('assign')}
            disabled={assignSpendControlPending}
            data-testid="button-assign-spend-control"
          >
            {t('wise.spendControls.assign')}
          </Button>
          <Button
            variant="outline"
            onClick={() => onAssignSpendControl('unassign')}
            disabled={unassignSpendControlPending}
            data-testid="button-unassign-spend-control"
          >
            {t('wise.spendControls.unassign')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
