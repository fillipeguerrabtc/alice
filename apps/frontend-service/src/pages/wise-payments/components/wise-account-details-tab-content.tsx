import { TabsContent } from '@/components/ui/tabs';
import { WiseAccountDetailsCreateCard } from './wise-account-details-create-card';
import { WiseAccountDetailsListCard } from './wise-account-details-list-card';
import { WiseAccountDetailsOrdersCard } from './wise-account-details-orders-card';
import type { WiseAccountDetailsTabContentProps } from './wise-account-details-tab-types';
import { WiseAccountDetailsToolbar } from './wise-account-details-toolbar';
import { WiseRecipientRequirementsCard } from './wise-recipient-requirements-card';

export function WiseAccountDetailsTabContent({
  accountDetails,
  accountDetailsOrders,
  accountDetailsPayload,
  accountDetailsResponse,
  isCreatingAccountDetailsOrder,
  isLoadingAccountDetails,
  isLoadingAccountDetailsOrders,
  onCreateAccountDetailsOrder,
  onFetchRecipientRequirements,
  onRecipientRequirementsFieldChange,
  onRefreshAccountDetails,
  onRefreshAccountDetailsOrders,
  profileFilter,
  profiles,
  recipientRequirementsForm,
  recipientRequirementsResult,
  setAccountDetailsPayload,
  setProfileFilter,
  t,
}: WiseAccountDetailsTabContentProps) {
  return (
    <TabsContent value="account-details" className="space-y-4 mt-6">
      <WiseAccountDetailsToolbar
        onRefreshAccountDetails={onRefreshAccountDetails}
        onRefreshAccountDetailsOrders={onRefreshAccountDetailsOrders}
        profileFilter={profileFilter}
        profiles={profiles}
        setProfileFilter={setProfileFilter}
        t={t}
      />

      <WiseAccountDetailsCreateCard
        accountDetailsPayload={accountDetailsPayload}
        accountDetailsResponse={accountDetailsResponse}
        isCreatingAccountDetailsOrder={isCreatingAccountDetailsOrder}
        onCreateAccountDetailsOrder={onCreateAccountDetailsOrder}
        setAccountDetailsPayload={setAccountDetailsPayload}
        t={t}
      />

      <WiseAccountDetailsListCard
        accountDetails={accountDetails}
        isLoadingAccountDetails={isLoadingAccountDetails}
        t={t}
      />

      <WiseAccountDetailsOrdersCard
        accountDetailsOrders={accountDetailsOrders}
        isLoadingAccountDetailsOrders={isLoadingAccountDetailsOrders}
        t={t}
      />

      <WiseRecipientRequirementsCard
        onFetchRecipientRequirements={onFetchRecipientRequirements}
        onRecipientRequirementsFieldChange={onRecipientRequirementsFieldChange}
        recipientRequirementsForm={recipientRequirementsForm}
        recipientRequirementsResult={recipientRequirementsResult}
        t={t}
      />
    </TabsContent>
  );
}
