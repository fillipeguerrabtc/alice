import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { WiseKycTabContentProps } from './wise-kyc-tab-types';

type WiseKycEvidencesCardProps = Pick<
  WiseKycTabContentProps,
  'isPendingFetchKycEvidences' | 'kycRequiredEvidences' | 'onFetchKycEvidences' | 't'
>;

export function WiseKycEvidencesCard({
  isPendingFetchKycEvidences,
  kycRequiredEvidences,
  onFetchKycEvidences,
  t,
}: WiseKycEvidencesCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.kyc.evidencesTitle')}</CardTitle>
        <CardDescription>{t('wise.kyc.evidencesSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          variant="outline"
          onClick={onFetchKycEvidences}
          disabled={isPendingFetchKycEvidences}
          data-testid="button-kyc-evidences"
        >
          {t('wise.kyc.fetchEvidences')}
        </Button>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
          {kycRequiredEvidences ?? t('wise.kyc.evidencesEmpty')}
        </pre>
      </CardContent>
    </Card>
  );
}
