import { TabsContent } from '@/components/ui/tabs';
import { WiseCardPermissionsCard } from './wise-card-permissions-card';
import { WiseCardSecureCard } from './wise-card-secure-card';
import { WiseRecipientsHeader } from './wise-recipients-header';
import { WiseRecipientsListCard } from './wise-recipients-list-card';
import type { WiseRecipientsTabContentProps } from './wise-recipients-tab-types';

export function WiseRecipientsTabContent({
  cardPermissionPayload,
  cardPermissionResult,
  cardPermissionToken,
  cardPermissionsPayload,
  cardPermissionsResult,
  cardSecureDetailsResult,
  cardSecureKeyResult,
  cardSecurePayload,
  cardSecurePinPayload,
  cardSecurePinResult,
  cardSecureToken,
  currencies,
  isLoadingRecipients,
  onDeleteRecipient,
  onFetchCardPermissions,
  onFetchCardSecureDetails,
  onFetchCardSecureKey,
  onFetchCardSecurePin,
  onUpdateCardPermissions,
  onUpdateCardPermissionsBulk,
  recipients,
  setCardPermissionPayload,
  setCardPermissionToken,
  setCardPermissionsPayload,
  setCardSecurePayload,
  setCardSecurePinPayload,
  setCardSecureToken,
  setShowNewRecipientDialog,
  showNewRecipientDialog,
  t,
}: WiseRecipientsTabContentProps) {
  return (
    <TabsContent value="recipients" className="space-y-4 mt-6">
      <WiseRecipientsHeader
        currencies={currencies}
        setShowNewRecipientDialog={setShowNewRecipientDialog}
        showNewRecipientDialog={showNewRecipientDialog}
        t={t}
      />

      <WiseRecipientsListCard
        isLoadingRecipients={isLoadingRecipients}
        onDeleteRecipient={onDeleteRecipient}
        recipients={recipients}
        t={t}
      />

      <WiseCardPermissionsCard
        cardPermissionPayload={cardPermissionPayload}
        cardPermissionResult={cardPermissionResult}
        cardPermissionToken={cardPermissionToken}
        cardPermissionsPayload={cardPermissionsPayload}
        cardPermissionsResult={cardPermissionsResult}
        onFetchCardPermissions={onFetchCardPermissions}
        onUpdateCardPermissions={onUpdateCardPermissions}
        onUpdateCardPermissionsBulk={onUpdateCardPermissionsBulk}
        setCardPermissionPayload={setCardPermissionPayload}
        setCardPermissionToken={setCardPermissionToken}
        setCardPermissionsPayload={setCardPermissionsPayload}
        t={t}
      />

      <WiseCardSecureCard
        cardSecureDetailsResult={cardSecureDetailsResult}
        cardSecureKeyResult={cardSecureKeyResult}
        cardSecurePayload={cardSecurePayload}
        cardSecurePinPayload={cardSecurePinPayload}
        cardSecurePinResult={cardSecurePinResult}
        cardSecureToken={cardSecureToken}
        onFetchCardSecureDetails={onFetchCardSecureDetails}
        onFetchCardSecureKey={onFetchCardSecureKey}
        onFetchCardSecurePin={onFetchCardSecurePin}
        setCardSecurePayload={setCardSecurePayload}
        setCardSecurePinPayload={setCardSecurePinPayload}
        setCardSecureToken={setCardSecureToken}
        t={t}
      />
    </TabsContent>
  );
}
