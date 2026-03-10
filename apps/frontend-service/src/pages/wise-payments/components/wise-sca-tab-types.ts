import type { TFunction } from 'i18next';

export type WiseProfileOption = {
  id: number;
  type: string;
};

export type WiseScaTabContentProps = {
  onRunSca: (endpoint: string) => void;
  onRunScaDelete: (endpoint: string) => void;
  profileFilter: string;
  profiles: WiseProfileOption[];
  scaJosePayload: string;
  scaResponse: string | null;
  setProfileFilter: (value: string) => void;
  setScaJosePayload: (value: string) => void;
  t: TFunction;
};
