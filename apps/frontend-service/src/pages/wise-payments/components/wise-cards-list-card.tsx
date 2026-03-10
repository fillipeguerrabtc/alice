import { Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { WiseCardsTabContentProps } from './wise-cards-tab-types';

type WiseCardsListCardProps = Pick<
  WiseCardsTabContentProps,
  | 'cardStatusUpdates'
  | 'cards'
  | 'isLoadingCards'
  | 'isUpdatingCardStatus'
  | 'onUpdateCardStatus'
  | 'profileFilter'
  | 'setCardStatusUpdates'
  | 't'
>;

export function WiseCardsListCard({
  cardStatusUpdates,
  cards,
  isLoadingCards,
  isUpdatingCardStatus,
  onUpdateCardStatus,
  profileFilter,
  setCardStatusUpdates,
  t,
}: WiseCardsListCardProps) {
  if (!profileFilter) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('wise.cards.missingProfile')}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoadingCards) {
    return <Skeleton className="h-64" />;
  }

  if (cards.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('wise.cards.noCards')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('wise.cards.cardToken')}</TableHead>
            <TableHead>{t('wise.cards.status')}</TableHead>
            <TableHead>{t('wise.cards.type')}</TableHead>
            <TableHead>{t('wise.cards.last4')}</TableHead>
            <TableHead>{t('wise.cards.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cards.map((card) => (
            <TableRow key={card.cardToken} data-testid={`row-card-${card.cardToken}`}>
              <TableCell className="font-mono">{card.cardToken}</TableCell>
              <TableCell>{card.status}</TableCell>
              <TableCell>{card.type ?? '-'}</TableCell>
              <TableCell>{card.lastFourDigits ?? '-'}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Input
                    value={cardStatusUpdates[card.cardToken] ?? ''}
                    onChange={(event) =>
                      setCardStatusUpdates((prev) => ({ ...prev, [card.cardToken]: event.target.value }))
                    }
                    placeholder="ACTIVE"
                    data-testid={`input-card-status-${card.cardToken}`}
                  />
                  <Button
                    size="sm"
                    onClick={() => onUpdateCardStatus(card.cardToken)}
                    disabled={isUpdatingCardStatus}
                    data-testid={`button-card-status-${card.cardToken}`}
                  >
                    {t('wise.cards.updateStatus')}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
