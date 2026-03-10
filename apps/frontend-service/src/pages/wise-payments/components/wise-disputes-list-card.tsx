import { AlertCircle } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { WiseDispute } from './wise-disputes-tab-types';

type WiseDisputesListCardProps = {
  disputes: WiseDispute[];
  formatDate: (value: string, options?: { locale?: string; timeZone?: string }) => string;
  isLoadingDisputes: boolean;
  locale: string;
  profileFilter: string;
  t: TFunction;
  timeZone: string;
};

export function WiseDisputesListCard({
  disputes,
  formatDate,
  isLoadingDisputes,
  locale,
  profileFilter,
  t,
  timeZone,
}: WiseDisputesListCardProps) {
  if (!profileFilter) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('wise.disputes.missingProfile')}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoadingDisputes) {
    return <Skeleton className="h-64" />;
  }

  if (disputes.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('wise.disputes.noDisputes')}</p>
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
            <TableHead>{t('wise.disputes.status')}</TableHead>
            <TableHead>{t('wise.disputes.reason')}</TableHead>
            <TableHead>{t('wise.disputes.scheme')}</TableHead>
            <TableHead>{t('wise.disputes.created')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {disputes.map((dispute, index) => (
            <TableRow key={dispute.id ?? `${index}`} data-testid={`row-dispute-${dispute.id ?? index}`}>
              <TableCell className="font-mono">{dispute.id ?? '-'}</TableCell>
              <TableCell>{dispute.status ?? '-'}</TableCell>
              <TableCell>{dispute.reason ?? '-'}</TableCell>
              <TableCell>{dispute.scheme ?? '-'}</TableCell>
              <TableCell>{dispute.created ? formatDate(dispute.created, { locale, timeZone }) : '-'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
