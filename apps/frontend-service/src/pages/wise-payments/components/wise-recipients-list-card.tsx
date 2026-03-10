import { Trash2, Users } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { WiseRecipient } from './wise-recipients-tab-types';

type WiseRecipientsListCardProps = {
  isLoadingRecipients: boolean;
  onDeleteRecipient: (recipientId: number) => void;
  recipients: WiseRecipient[];
  t: TFunction;
};

export function WiseRecipientsListCard({
  isLoadingRecipients,
  onDeleteRecipient,
  recipients,
  t,
}: WiseRecipientsListCardProps) {
  if (isLoadingRecipients) {
    return <Skeleton className="h-64" />;
  }

  if (recipients.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Users className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('wise.recipients.noRecipients')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>{t('wise.recipients.name')}</TableHead>
            <TableHead>{t('wise.recipients.currency')}</TableHead>
            <TableHead>{t('wise.recipients.accountType')}</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recipients.map((recipient) => (
            <TableRow key={recipient.id} data-testid={`row-recipient-${recipient.id}`}>
              <TableCell className="font-mono">{recipient.id}</TableCell>
              <TableCell className="font-medium">{recipient.accountHolderName}</TableCell>
              <TableCell>
                <Badge variant="outline">{recipient.currency}</Badge>
              </TableCell>
              <TableCell>{recipient.type}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDeleteRecipient(recipient.id)}
                  data-testid={`button-delete-recipient-${recipient.id}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
