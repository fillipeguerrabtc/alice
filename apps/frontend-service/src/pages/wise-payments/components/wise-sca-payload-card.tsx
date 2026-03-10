import type { TFunction } from 'i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { WiseScaActionButtons } from './wise-sca-action-buttons';

type WiseScaPayloadCardProps = {
  onRunSca: (endpoint: string) => void;
  onRunScaDelete: (endpoint: string) => void;
  scaJosePayload: string;
  scaResponse: string | null;
  setScaJosePayload: (value: string) => void;
  t: TFunction;
};

export function WiseScaPayloadCard({
  onRunSca,
  onRunScaDelete,
  scaJosePayload,
  scaResponse,
  setScaJosePayload,
  t,
}: WiseScaPayloadCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.sca.payloadTitle')}</CardTitle>
        <CardDescription>{t('wise.sca.payloadSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={scaJosePayload}
          onChange={(event) => setScaJosePayload(event.target.value)}
          rows={6}
          placeholder="{ }"
          data-testid="textarea-sca-payload"
        />

        <WiseScaActionButtons
          onRunSca={onRunSca}
          onRunScaDelete={onRunScaDelete}
          t={t}
        />

        <div className="space-y-2">
          <Label>{t('wise.sca.response')}</Label>
          <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
            {scaResponse ?? t('wise.sca.responseEmpty')}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
