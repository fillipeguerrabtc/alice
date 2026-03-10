import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type WiseCardSecureCardProps = {
  cardSecureDetailsResult: string | null;
  cardSecureKeyResult: string | null;
  cardSecurePayload: string;
  cardSecurePinPayload: string;
  cardSecurePinResult: string | null;
  cardSecureToken: string;
  onFetchCardSecureDetails: () => void;
  onFetchCardSecureKey: () => void;
  onFetchCardSecurePin: () => void;
  setCardSecurePayload: (value: string) => void;
  setCardSecurePinPayload: (value: string) => void;
  setCardSecureToken: (value: string) => void;
  t: TFunction;
};

export function WiseCardSecureCard({
  cardSecureDetailsResult,
  cardSecureKeyResult,
  cardSecurePayload,
  cardSecurePinPayload,
  cardSecurePinResult,
  cardSecureToken,
  onFetchCardSecureDetails,
  onFetchCardSecureKey,
  onFetchCardSecurePin,
  setCardSecurePayload,
  setCardSecurePinPayload,
  setCardSecureToken,
  t,
}: WiseCardSecureCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.cards.secureTitle')}</CardTitle>
        <CardDescription>{t('wise.cards.secureSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Input
            value={cardSecureToken}
            onChange={(event) => setCardSecureToken(event.target.value)}
            placeholder={t('wise.cards.cardToken')}
            data-testid="input-card-secure-token"
          />
          <Button variant="outline" onClick={onFetchCardSecureKey} data-testid="button-card-secure-key">
            {t('wise.cards.secureFetchKey')}
          </Button>
        </div>
        <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
          {cardSecureKeyResult ?? t('wise.cards.secureKeyEmpty')}
        </pre>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('wise.cards.secureDetailsPayload')}</Label>
            <Textarea
              value={cardSecurePayload}
              onChange={(event) => setCardSecurePayload(event.target.value)}
              rows={5}
              placeholder="{ }"
              data-testid="textarea-card-secure-details"
            />
            <Button onClick={onFetchCardSecureDetails} data-testid="button-card-secure-details">
              {t('wise.cards.secureFetchDetails')}
            </Button>
            <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
              {cardSecureDetailsResult ?? t('wise.cards.secureDetailsEmpty')}
            </pre>
          </div>
          <div className="space-y-2">
            <Label>{t('wise.cards.securePinPayload')}</Label>
            <Textarea
              value={cardSecurePinPayload}
              onChange={(event) => setCardSecurePinPayload(event.target.value)}
              rows={5}
              placeholder="{ }"
              data-testid="textarea-card-secure-pin"
            />
            <Button onClick={onFetchCardSecurePin} data-testid="button-card-secure-pin">
              {t('wise.cards.secureFetchPin')}
            </Button>
            <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
              {cardSecurePinResult ?? t('wise.cards.securePinEmpty')}
            </pre>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
