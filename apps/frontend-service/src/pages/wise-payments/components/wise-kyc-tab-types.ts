import type { TFunction } from 'i18next';

export type WiseProfileOption = {
  id: number;
  type: string;
};

export type WiseKycReview = {
  id?: string;
  status?: string;
  created?: string;
  updated?: string;
};

export type WiseKycTabContentProps = {
  formatDate: (value: string, options?: { locale?: string; timeZone?: string }) => string;
  isLoadingKycReviews: boolean;
  isPendingFetchKycEvidences: boolean;
  isPendingUploadKycAdditional: boolean;
  isPendingUploadKycDocument: boolean;
  kycRequiredEvidences: string | null;
  kycReviews: WiseKycReview[];
  locale: string;
  onFetchKycEvidences: () => void;
  onKycDocumentChange: (file: File | null, uploadType: 'document' | 'additional') => void | Promise<void>;
  onRefreshKycReviews: () => void;
  onUploadKycAdditional: () => void;
  onUploadKycDocument: () => void;
  profileFilter: string;
  profiles: WiseProfileOption[];
  setProfileFilter: (value: string) => void;
  t: TFunction;
  timeZone: string;
};
