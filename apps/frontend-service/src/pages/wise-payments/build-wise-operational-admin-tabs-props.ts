import { WISE_CATALOG_OPERATIONS } from './wise-payments-constants';
import type {
  BuildWiseOperationalTabsPropsOptions,
  WiseOperationalAdminTabsProps,
} from './wise-operational-tabs-props-types';

export function buildWiseOperationalAdminTabsProps({
  cardSpendActions,
  catalogWorkbench,
  dataQueries,
  derivedData,
  refreshActions,
  t,
  userActivityActions,
}: BuildWiseOperationalTabsPropsOptions): WiseOperationalAdminTabsProps {
  const profilesTabProps = {
    isLoadingProfiles: dataQueries.isLoadingProfiles,
    onRefreshProfiles: refreshActions.handleRefreshProfiles,
    profiles: derivedData.profiles,
    t,
  };

  const usersTabProps = {
    isLoadingWiseUserMe: dataQueries.isLoadingWiseUserMe,
    onFetchWiseUser: userActivityActions.handleFetchWiseUser,
    onRefreshWiseUserMe: refreshActions.handleRefreshWiseUserMe,
    setWiseUserId: userActivityActions.setWiseUserId,
    t,
    wiseUserId: userActivityActions.wiseUserId,
    wiseUserMeDataUser: dataQueries.wiseUserMeData?.user ?? null,
    wiseUserResult: userActivityActions.wiseUserResult,
  };

  const activitiesTabProps = {
    activityFilters: userActivityActions.activityFilters,
    activityResults: userActivityActions.activityResults,
    onActivityFilterChange: userActivityActions.handleActivityFilterChange,
    onListActivities: userActivityActions.handleListActivities,
    t,
  };

  const spendLimitsTabProps = {
    isPendingDeleteSpendLimitsCard: cardSpendActions.isPendingDeleteSpendLimitsCard,
    isPendingUpdateSpendLimitsCard: cardSpendActions.isPendingUpdateSpendLimitsCard,
    isPendingUpdateSpendLimitsProfile: cardSpendActions.isPendingUpdateSpendLimitsProfile,
    onDeleteSpendLimitsCard: cardSpendActions.handleDeleteSpendLimitsCard,
    onFetchSpendLimitsCard: cardSpendActions.handleFetchSpendLimitsCard,
    onFetchSpendLimitsProfile: cardSpendActions.handleFetchSpendLimitsProfile,
    onUpdateSpendLimitsCard: cardSpendActions.handleUpdateSpendLimitsCard,
    onUpdateSpendLimitsProfile: cardSpendActions.handleUpdateSpendLimitsProfile,
    setSpendLimitsCardPayload: cardSpendActions.setSpendLimitsCardPayload,
    setSpendLimitsCardToken: cardSpendActions.setSpendLimitsCardToken,
    setSpendLimitsDeleteCardToken: cardSpendActions.setSpendLimitsDeleteCardToken,
    setSpendLimitsPayload: cardSpendActions.setSpendLimitsPayload,
    setSpendLimitsProfileId: cardSpendActions.setSpendLimitsProfileId,
    spendLimitsCardPayload: cardSpendActions.spendLimitsCardPayload,
    spendLimitsCardResult: cardSpendActions.spendLimitsCardResult,
    spendLimitsCardToken: cardSpendActions.spendLimitsCardToken,
    spendLimitsDeleteCardToken: cardSpendActions.spendLimitsDeleteCardToken,
    spendLimitsPayload: cardSpendActions.spendLimitsPayload,
    spendLimitsProfileId: cardSpendActions.spendLimitsProfileId,
    spendLimitsProfileResult: cardSpendActions.spendLimitsProfileResult,
    t,
  };

  const catalogTabProps = {
    catalogBody: catalogWorkbench.catalogBody,
    catalogEndpoint: catalogWorkbench.catalogEndpoint,
    catalogError: catalogWorkbench.catalogError,
    catalogLoading: catalogWorkbench.catalogLoading,
    catalogOperation: catalogWorkbench.catalogOperation,
    catalogOperationId: catalogWorkbench.catalogOperationId,
    catalogParams: catalogWorkbench.catalogParams,
    catalogResponse: catalogWorkbench.catalogResponse,
    onRunCatalogOperation: catalogWorkbench.handleRunCatalogOperation,
    setCatalogBody: catalogWorkbench.setCatalogBody,
    setCatalogEndpoint: catalogWorkbench.setCatalogEndpoint,
    setCatalogOperationId: catalogWorkbench.setCatalogOperationId,
    setCatalogParams: catalogWorkbench.setCatalogParams,
    t,
    wiseCatalogOperations: WISE_CATALOG_OPERATIONS,
  };

  return {
    activitiesTabProps,
    catalogTabProps,
    profilesTabProps,
    spendLimitsTabProps,
    usersTabProps,
  };
}
