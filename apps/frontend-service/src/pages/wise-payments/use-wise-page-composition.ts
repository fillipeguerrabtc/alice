import type { TFunction } from 'i18next';
import type { useToast } from '@/hooks/use-toast';
import { useWiseFileUploadState } from './use-wise-file-upload-state';
import { useWiseDataQueries } from './use-wise-data-queries';
import { useWiseJsonParser } from './use-wise-json-parser';
import { useWiseNavigationState } from './use-wise-navigation-state';
import { useWiseNavigationPresentation } from './use-wise-navigation-presentation';
import { useWiseActionsSuite } from './use-wise-actions-suite';
import { useWiseRefreshDerived } from './use-wise-refresh-derived';
import { buildWiseProfileTabsProps } from './build-wise-profile-tabs-props';
import { buildWiseOperationalAdminTabsProps } from './build-wise-operational-admin-tabs-props';
import { buildWiseOperationalFinanceTabsProps } from './build-wise-operational-finance-tabs-props';

type ToastFn = ReturnType<typeof useToast>['toast'];

type UseWisePageCompositionOptions = {
  locale: string;
  notify: ToastFn;
  t: TFunction;
  timeZone: string;
};

export function useWisePageComposition({
  locale,
  notify,
  t,
  timeZone,
}: UseWisePageCompositionOptions) {
  const {
    activeTab,
    activeWorkspace,
    handleWiseTabChange,
    handleWiseWorkspaceChange,
    visibleTabs,
  } = useWiseNavigationState();
  const {
    handleWiseWorkspaceSelectionChange,
    wiseTabOptions,
    wiseWorkspaceOptions,
  } = useWiseNavigationPresentation({
    handleWiseWorkspaceChange,
    t,
    visibleTabs,
  });
  const { parseJsonSafe } = useWiseJsonParser({ notify });

  const dataQueries = useWiseDataQueries({
    notify,
  });
  const fileUploadState = useWiseFileUploadState();
  const {
    accountCardDisputeActions,
    balanceExchangeStatementActions,
    cardSpendActions,
    catalogWorkbench,
    recipientActions,
    referenceActions,
    transferAndCardActions,
    userActivityActions,
    webhookSimulationScaActions,
  } = useWiseActionsSuite({
    dataQueries,
    fileUploadState,
    notify,
    parseJsonSafe,
    t,
  });

  const {
    derivedData,
    refreshActions,
  } = useWiseRefreshDerived({
    dataQueries,
  });
  const profileScopedTabProps = {
    profileFilter: dataQueries.profileFilter,
    profiles: derivedData.profiles,
    setProfileFilter: dataQueries.setProfileFilter,
  };
  const profileTabsProps = buildWiseProfileTabsProps({
    accountCardDisputeActions,
    cardSpendActions,
    dataQueries,
    derivedData,
    fileUploadState,
    locale,
    profileScopedTabProps,
    referenceActions,
    refreshActions,
    t,
    timeZone,
    webhookSimulationScaActions,
  });
  const operationalFinanceTabsProps = buildWiseOperationalFinanceTabsProps({
    balanceExchangeStatementActions,
    cardSpendActions,
    catalogWorkbench,
    dataQueries,
    derivedData,
    locale,
    recipientActions,
    referenceActions,
    refreshActions,
    t,
    timeZone,
    transferAndCardActions,
    userActivityActions,
  });
  const operationalAdminTabsProps = buildWiseOperationalAdminTabsProps({
    balanceExchangeStatementActions,
    cardSpendActions,
    catalogWorkbench,
    dataQueries,
    derivedData,
    locale,
    recipientActions,
    referenceActions,
    refreshActions,
    t,
    timeZone,
    transferAndCardActions,
    userActivityActions,
  });
  const tabsContentProps = {
    ...profileTabsProps,
    ...operationalFinanceTabsProps,
    ...operationalAdminTabsProps,
  };

  return {
    activeTab,
    activeWorkspace,
    dataQueries,
    handleWiseTabChange,
    handleWiseWorkspaceSelectionChange,
    refreshActions,
    tabsContentProps,
    wiseTabOptions,
    wiseWorkspaceOptions,
  };
}
