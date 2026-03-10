import { FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { WiseAccountDetailsTabContentProps } from './wise-account-details-tab-types';

type WiseAccountDetailsListCardProps = Pick<
  WiseAccountDetailsTabContentProps,
  'accountDetails' | 'isLoadingAccountDetails' | 't'
>;

export function WiseAccountDetailsListCard({
  accountDetails,
  isLoadingAccountDetails,
  t,
}: WiseAccountDetailsListCardProps) {
  if (isLoadingAccountDetails) {
    return <Skeleton className="h-48" />;
  }

  if (accountDetails.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <FileText className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('wise.accountDetails.noDetails')}</p>
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
            <TableHead>{t('wise.accountDetails.currency')}</TableHead>
            <TableHead>{t('wise.accountDetails.holder')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accountDetails.map((detail, index) => (
            <TableRow key={detail.id ?? `${index}`} data-testid={`row-account-detail-${detail.id ?? index}`}>
              <TableCell className="font-mono">{detail.id ?? '-'}</TableCell>
              <TableCell>{detail.currency ?? '-'}</TableCell>
              <TableCell>{detail.accountHolderName ?? '-'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
