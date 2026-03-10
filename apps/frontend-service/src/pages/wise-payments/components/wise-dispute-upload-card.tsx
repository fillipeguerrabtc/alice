import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type WiseDisputeUploadCardProps = {
  isPendingDisputeFileUpload: boolean;
  onDisputeFileChange: (file: File | null) => void;
  onDisputeFileUpload: () => void;
  t: TFunction;
};

export function WiseDisputeUploadCard({
  isPendingDisputeFileUpload,
  onDisputeFileChange,
  onDisputeFileUpload,
  t,
}: WiseDisputeUploadCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.disputes.uploadTitle')}</CardTitle>
        <CardDescription>{t('wise.disputes.uploadSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          type="file"
          onChange={(event) => onDisputeFileChange(event.target.files?.[0] ?? null)}
          data-testid="input-dispute-file"
        />
        <Button onClick={onDisputeFileUpload} disabled={isPendingDisputeFileUpload} data-testid="button-dispute-upload">
          {t('wise.disputes.upload')}
        </Button>
      </CardContent>
    </Card>
  );
}
