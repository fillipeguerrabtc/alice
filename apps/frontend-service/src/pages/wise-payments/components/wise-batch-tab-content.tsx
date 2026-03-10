import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { Layers, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TabsContent } from '@/components/ui/tabs';

type WiseBatchGroup = {
  id: string;
  name: string;
  status: string;
  sourceCurrency: string;
  created: string;
};

type WiseBatchTabContentProps = {
  batchGroups: WiseBatchGroup[];
  formatDate: (value: string, options: { locale?: string; timeZone?: string }) => string;
  getStatusBadge: (status: string) => ReactNode;
  isLoadingBatchGroups: boolean;
  locale: string;
  t: TFunction;
  timeZone: string;
};

export function WiseBatchTabContent({
  batchGroups,
  formatDate,
  getStatusBadge,
  isLoadingBatchGroups,
  locale,
  t,
  timeZone,
}: WiseBatchTabContentProps) {
  return (
    <TabsContent value="batch" className="space-y-4 mt-6">
      <div className="flex justify-between items-center">
        <CardDescription>{t('wise.batch.subtitle')}</CardDescription>
        <Button data-testid="button-new-batch">
          <Plus className="h-4 w-4 mr-2" />
          {t('wise.batch.new')}
        </Button>
      </div>

      {isLoadingBatchGroups ? (
        <Skeleton className="h-64" />
      ) : batchGroups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Layers className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">{t('wise.batch.noBatches')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>{t('wise.batch.name')}</TableHead>
                <TableHead>{t('wise.batch.status')}</TableHead>
                <TableHead>{t('wise.recipients.currency')}</TableHead>
                <TableHead>{t('wise.transfers.created')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batchGroups.map((batch) => (
                <TableRow key={batch.id} data-testid={`row-batch-${batch.id}`}>
                  <TableCell className="font-mono">{batch.id}</TableCell>
                  <TableCell className="font-medium">{batch.name}</TableCell>
                  <TableCell>{getStatusBadge(batch.status)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{batch.sourceCurrency}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(batch.created, { locale, timeZone })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </TabsContent>
  );
}
