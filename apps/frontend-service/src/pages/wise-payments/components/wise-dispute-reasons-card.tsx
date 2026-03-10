import type { TFunction } from 'i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type WiseDisputeReasonsCardProps = {
  disputeReasonsData: unknown;
  isLoadingDisputeReasons: boolean;
  t: TFunction;
};

export function WiseDisputeReasonsCard({
  disputeReasonsData,
  isLoadingDisputeReasons,
  t,
}: WiseDisputeReasonsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.disputes.reasonsTitle')}</CardTitle>
        <CardDescription>{t('wise.disputes.reasonsSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoadingDisputeReasons ? (
          <Skeleton className="h-32" />
        ) : (
          <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
            {disputeReasonsData ? JSON.stringify(disputeReasonsData, null, 2) : t('wise.disputes.noReasons')}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
