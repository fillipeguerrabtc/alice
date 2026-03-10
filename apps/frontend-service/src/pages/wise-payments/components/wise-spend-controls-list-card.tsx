import { Layers } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { WiseSpendControl } from './wise-spend-controls-tab-types';

type WiseSpendControlsListCardProps = {
  formatNumber: (value: number, locale?: string) => string;
  isLoadingSpendControls: boolean;
  locale: string;
  profileFilter: string;
  spendControls: WiseSpendControl[];
  t: TFunction;
};

export function WiseSpendControlsListCard({
  formatNumber,
  isLoadingSpendControls,
  locale,
  profileFilter,
  spendControls,
  t,
}: WiseSpendControlsListCardProps) {
  if (!profileFilter) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Layers className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('wise.spendControls.missingProfile')}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoadingSpendControls) {
    return <Skeleton className="h-64" />;
  }

  if (spendControls.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Layers className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('wise.spendControls.noRules')}</p>
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
            <TableHead>{t('wise.spendControls.name')}</TableHead>
            <TableHead>{t('wise.spendControls.currency')}</TableHead>
            <TableHead>{t('wise.spendControls.amount')}</TableHead>
            <TableHead>{t('wise.spendControls.period')}</TableHead>
            <TableHead>{t('wise.spendControls.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {spendControls.map((rule, index) => (
            <TableRow key={rule.id ?? `${rule.name}-${index}`} data-testid={`row-spend-${rule.id ?? index}`}>
              <TableCell className="font-mono">{rule.id ?? '-'}</TableCell>
              <TableCell>{rule.name ?? '-'}</TableCell>
              <TableCell>{rule.currency ?? '-'}</TableCell>
              <TableCell>{rule.maxAmount !== undefined ? formatNumber(rule.maxAmount, locale) : '-'}</TableCell>
              <TableCell>{rule.period ?? '-'}</TableCell>
              <TableCell>{rule.status ?? '-'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
