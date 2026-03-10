import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { WiseKycTabContentProps } from './wise-kyc-tab-types';

type UploadType = 'document' | 'additional';

type WiseKycUploadCardProps = Pick<
  WiseKycTabContentProps,
  'onKycDocumentChange' | 'onUploadKycAdditional' | 'onUploadKycDocument' | 't'
> & {
  isPending: boolean;
  uploadType: UploadType;
};

const KYC_UPLOAD_CARD_CONTENT: Record<
  UploadType,
  {
    buttonKey: string;
    buttonTestId: string;
    descriptionKey: string;
    inputTestId: string;
    titleKey: string;
  }
> = {
  additional: {
    buttonKey: 'wise.kyc.uploadAdditional',
    buttonTestId: 'button-kyc-additional-upload',
    descriptionKey: 'wise.kyc.uploadAdditionalSubtitle',
    inputTestId: 'input-kyc-additional',
    titleKey: 'wise.kyc.uploadAdditionalTitle',
  },
  document: {
    buttonKey: 'wise.kyc.uploadDocument',
    buttonTestId: 'button-kyc-document-upload',
    descriptionKey: 'wise.kyc.uploadDocumentSubtitle',
    inputTestId: 'input-kyc-document',
    titleKey: 'wise.kyc.uploadDocumentTitle',
  },
};

export function WiseKycUploadCard({
  isPending,
  onKycDocumentChange,
  onUploadKycAdditional,
  onUploadKycDocument,
  t,
  uploadType,
}: WiseKycUploadCardProps) {
  const content = KYC_UPLOAD_CARD_CONTENT[uploadType];
  const onUpload = uploadType === 'document' ? onUploadKycDocument : onUploadKycAdditional;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(content.titleKey)}</CardTitle>
        <CardDescription>{t(content.descriptionKey)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          type="file"
          onChange={(event) => onKycDocumentChange(event.target.files?.[0] ?? null, uploadType)}
          data-testid={content.inputTestId}
        />
        <Button onClick={onUpload} disabled={isPending} data-testid={content.buttonTestId}>
          {t(content.buttonKey)}
        </Button>
      </CardContent>
    </Card>
  );
}
