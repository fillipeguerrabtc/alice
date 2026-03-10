import { TabsContent } from '@/components/ui/tabs';
import { WiseKycEvidencesCard } from './wise-kyc-evidences-card';
import { WiseKycReviewsCard } from './wise-kyc-reviews-card';
import type { WiseKycTabContentProps } from './wise-kyc-tab-types';
import { WiseKycToolbar } from './wise-kyc-toolbar';
import { WiseKycUploadCard } from './wise-kyc-upload-card';

export function WiseKycTabContent({
  formatDate,
  isLoadingKycReviews,
  isPendingFetchKycEvidences,
  isPendingUploadKycAdditional,
  isPendingUploadKycDocument,
  kycRequiredEvidences,
  kycReviews,
  locale,
  onFetchKycEvidences,
  onKycDocumentChange,
  onRefreshKycReviews,
  onUploadKycAdditional,
  onUploadKycDocument,
  profileFilter,
  profiles,
  setProfileFilter,
  t,
  timeZone,
}: WiseKycTabContentProps) {
  return (
    <TabsContent value="kyc" className="space-y-4 mt-6">
      <WiseKycToolbar
        onRefreshKycReviews={onRefreshKycReviews}
        profileFilter={profileFilter}
        profiles={profiles}
        setProfileFilter={setProfileFilter}
        t={t}
      />

      <WiseKycEvidencesCard
        isPendingFetchKycEvidences={isPendingFetchKycEvidences}
        kycRequiredEvidences={kycRequiredEvidences}
        onFetchKycEvidences={onFetchKycEvidences}
        t={t}
      />

      <WiseKycUploadCard
        isPending={isPendingUploadKycDocument}
        onKycDocumentChange={onKycDocumentChange}
        onUploadKycAdditional={onUploadKycAdditional}
        onUploadKycDocument={onUploadKycDocument}
        t={t}
        uploadType="document"
      />

      <WiseKycUploadCard
        isPending={isPendingUploadKycAdditional}
        onKycDocumentChange={onKycDocumentChange}
        onUploadKycAdditional={onUploadKycAdditional}
        onUploadKycDocument={onUploadKycDocument}
        t={t}
        uploadType="additional"
      />

      <WiseKycReviewsCard
        formatDate={formatDate}
        isLoadingKycReviews={isLoadingKycReviews}
        kycReviews={kycReviews}
        locale={locale}
        profileFilter={profileFilter}
        t={t}
        timeZone={timeZone}
      />
    </TabsContent>
  );
}
