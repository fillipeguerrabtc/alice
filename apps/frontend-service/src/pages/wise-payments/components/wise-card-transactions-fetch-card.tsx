import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WiseCardTransactionsTabContentProps } from './wise-card-transactions-tab-types';

type WiseCardTransactionsFetchCardProps = Pick<
  WiseCardTransactionsTabContentProps,
  | 'cardTransactionDetails'
  | 'cardTransactionId'
  | 'isPendingCardTransactionFetch'
  | 'onFetchCardTransaction'
  | 'setCardTransactionId'
  | 't'
>;

export function WiseCardTransactionsFetchCard({
  cardTransactionDetails,
  cardTransactionId,
  isPendingCardTransactionFetch,
  onFetchCardTransaction,
  setCardTransactionId,
  t,
}: WiseCardTransactionsFetchCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.cardTransactions.fetchTitle')}</CardTitle>
        <CardDescription>{t('wise.cardTransactions.fetchSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={cardTransactionId}
          onChange={(event) => setCardTransactionId(event.target.value)}
          placeholder={t('wise.cardTransactions.transactionId')}
          data-testid="input-card-transaction-id"
        />
        <Button
          onClick={onFetchCardTransaction}
          disabled={isPendingCardTransactionFetch}
          data-testid="button-card-transaction-fetch"
        >
          {t('wise.cardTransactions.fetch')}
        </Button>
        <div className="space-y-2">
          <Label>{t('wise.cardTransactions.response')}</Label>
          <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
            {cardTransactionDetails ?? t('wise.cardTransactions.responseEmpty')}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
