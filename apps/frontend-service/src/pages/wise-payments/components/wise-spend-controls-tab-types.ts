import type { TFunction } from 'i18next';

export type WiseProfileOption = {
  id: number;
  type: string;
};

export type WiseCurrencyOption = {
  code: string;
  name: string;
};

export type WiseSpendControl = {
  id?: string;
  name?: string;
  status?: string;
  currency?: string;
  maxAmount?: number;
  period?: string;
};

export type WiseSpendControlForm = {
  name: string;
  currency: string;
  maxAmount: string;
  period: string;
};

export type WiseSpendControlAssignment = {
  ruleId: string;
  cardToken: string;
};

export type WiseSpendControlsTabContentProps = {
  assignSpendControlPending: boolean;
  createSpendControlPending: boolean;
  currencies: WiseCurrencyOption[];
  deleteSpendControlPending: boolean;
  formatNumber: (value: number, locale?: string) => string;
  isLoadingSpendControls: boolean;
  locale: string;
  onAssignSpendControl: (assign: 'assign' | 'unassign') => void;
  onCreateSpendControl: () => void;
  onDeleteSpendControl: () => void;
  onRefreshSpendControls: () => void;
  profileFilter: string;
  profiles: WiseProfileOption[];
  setProfileFilter: (value: string) => void;
  setSpendControlAssignment: (updater: (prev: WiseSpendControlAssignment) => WiseSpendControlAssignment) => void;
  setSpendControlDeleteId: (value: string) => void;
  setSpendControlForm: (updater: (prev: WiseSpendControlForm) => WiseSpendControlForm) => void;
  spendControlAssignment: WiseSpendControlAssignment;
  spendControlDeleteId: string;
  spendControlForm: WiseSpendControlForm;
  spendControls: WiseSpendControl[];
  t: TFunction;
  unassignSpendControlPending: boolean;
};
