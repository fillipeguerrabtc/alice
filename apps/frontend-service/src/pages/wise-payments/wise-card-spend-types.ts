import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';

export type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

export type ParseJsonSafeFn = (
  raw: string,
  errorTitle: string
) => Record<string, unknown> | null;

export type SpendControlForm = {
  name: string;
  maxAmount: string;
  currency: string;
  period: string;
};

export type SpendControlAssignment = {
  ruleId: string;
  cardToken: string;
};

export type UseWiseCardSpendActionsOptions = {
  notify: NotifyFn;
  parseJsonSafe: ParseJsonSafeFn;
  profileFilter: string;
  t: TFunction;
};

export type UseWiseCardSpendActionsResult = {
  cardStatusUpdates: Record<string, string>;
  handleAssignSpendControl: (assign: 'assign' | 'unassign') => void;
  handleCreateSpendControl: () => void;
  handleDeleteSpendControl: () => void;
  handleDeleteSpendLimitsCard: () => void;
  handleFetchSpendLimitsCard: () => void;
  handleFetchSpendLimitsProfile: () => void;
  handleUpdateCardStatus: (cardToken: string) => void;
  handleUpdateSpendLimitsCard: () => void;
  handleUpdateSpendLimitsProfile: () => void;
  isPendingAssignSpendControl: boolean;
  isPendingCreateSpendControl: boolean;
  isPendingDeleteSpendControl: boolean;
  isPendingDeleteSpendLimitsCard: boolean;
  isPendingUnassignSpendControl: boolean;
  isPendingUpdateCardStatus: boolean;
  isPendingUpdateSpendLimitsCard: boolean;
  isPendingUpdateSpendLimitsProfile: boolean;
  setCardStatusUpdates: Dispatch<SetStateAction<Record<string, string>>>;
  setSpendControlAssignment: Dispatch<SetStateAction<SpendControlAssignment>>;
  setSpendControlDeleteId: (value: string) => void;
  setSpendControlForm: Dispatch<SetStateAction<SpendControlForm>>;
  setSpendLimitsCardPayload: (value: string) => void;
  setSpendLimitsCardToken: (value: string) => void;
  setSpendLimitsDeleteCardToken: (value: string) => void;
  setSpendLimitsPayload: (value: string) => void;
  setSpendLimitsProfileId: (value: string) => void;
  spendControlAssignment: SpendControlAssignment;
  spendControlDeleteId: string;
  spendControlForm: SpendControlForm;
  spendLimitsCardPayload: string;
  spendLimitsCardResult: string | null;
  spendLimitsCardToken: string;
  spendLimitsDeleteCardToken: string;
  spendLimitsPayload: string;
  spendLimitsProfileId: string;
  spendLimitsProfileResult: string | null;
};

export const INITIAL_SPEND_CONTROL_FORM: SpendControlForm = {
  name: '',
  maxAmount: '',
  currency: '',
  period: '',
};

export const INITIAL_SPEND_CONTROL_ASSIGNMENT: SpendControlAssignment = {
  ruleId: '',
  cardToken: '',
};
