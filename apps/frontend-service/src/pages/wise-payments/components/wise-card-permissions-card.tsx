import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type WiseCardPermissionsCardProps = {
  cardPermissionPayload: string;
  cardPermissionResult: string | null;
  cardPermissionToken: string;
  cardPermissionsPayload: string;
  cardPermissionsResult: string | null;
  onFetchCardPermissions: () => void;
  onUpdateCardPermissions: () => void;
  onUpdateCardPermissionsBulk: () => void;
  setCardPermissionPayload: (value: string) => void;
  setCardPermissionToken: (value: string) => void;
  setCardPermissionsPayload: (value: string) => void;
  t: TFunction;
};

export function WiseCardPermissionsCard({
  cardPermissionPayload,
  cardPermissionResult,
  cardPermissionToken,
  cardPermissionsPayload,
  cardPermissionsResult,
  onFetchCardPermissions,
  onUpdateCardPermissions,
  onUpdateCardPermissionsBulk,
  setCardPermissionPayload,
  setCardPermissionToken,
  setCardPermissionsPayload,
  t,
}: WiseCardPermissionsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.cards.permissionsTitle')}</CardTitle>
        <CardDescription>{t('wise.cards.permissionsSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            value={cardPermissionToken}
            onChange={(event) => setCardPermissionToken(event.target.value)}
            placeholder={t('wise.cards.cardToken')}
            data-testid="input-card-permissions-token"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onFetchCardPermissions} data-testid="button-card-permissions-fetch">
              {t('wise.cards.permissionsFetch')}
            </Button>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('wise.cards.permissionsPayload')}</Label>
            <Textarea
              value={cardPermissionPayload}
              onChange={(event) => setCardPermissionPayload(event.target.value)}
              rows={5}
              placeholder="{ }"
              data-testid="textarea-card-permissions"
            />
            <Button onClick={onUpdateCardPermissions} data-testid="button-card-permissions-update">
              {t('wise.cards.permissionsUpdate')}
            </Button>
          </div>
          <div className="space-y-2">
            <Label>{t('wise.cards.permissionsBulkPayload')}</Label>
            <Textarea
              value={cardPermissionsPayload}
              onChange={(event) => setCardPermissionsPayload(event.target.value)}
              rows={5}
              placeholder="{ }"
              data-testid="textarea-card-permissions-bulk"
            />
            <Button onClick={onUpdateCardPermissionsBulk} data-testid="button-card-permissions-bulk">
              {t('wise.cards.permissionsUpdateBulk')}
            </Button>
          </div>
        </div>
        <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
          {cardPermissionResult ?? cardPermissionsResult ?? t('wise.cards.permissionsEmpty')}
        </pre>
      </CardContent>
    </Card>
  );
}
