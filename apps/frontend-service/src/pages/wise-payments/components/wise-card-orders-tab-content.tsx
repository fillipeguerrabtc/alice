import { CardDescription } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import { WiseCardOrdersActionsCard } from './wise-card-orders-actions-card';
import { WiseCardOrdersCreateCard } from './wise-card-orders-create-card';
import { WiseCardOrdersListCard } from './wise-card-orders-list-card';
import type { WiseCardOrdersTabContentProps } from './wise-card-orders-tab-types';
import { WiseCardOrdersToolbar } from './wise-card-orders-toolbar';

export function WiseCardOrdersTabContent({
  cardOrderAvailability,
  cardOrderDetails,
  cardOrderId,
  cardOrderPayload,
  cardOrderPinPayload,
  cardOrderRequirements,
  cardOrderStatusPayload,
  cardOrderValidationPayload,
  cardOrders,
  cardOrdersPage,
  formatDate,
  isLoadingCardOrders,
  isPendingCardOrderAvailability,
  isPendingCardOrderCreate,
  isPendingCardOrderPin,
  isPendingCardOrderStatusUpdate,
  isPendingCardOrderValidateAddress,
  locale,
  onCreateCardOrder,
  onFetchCardOrderAvailability,
  onFetchCardOrderDetails,
  onFetchCardOrderRequirements,
  onRefreshCardOrders,
  onSetCardOrderPin,
  onUpdateCardOrderStatus,
  onValidateCardOrderAddress,
  profileFilter,
  profiles,
  setCardOrderId,
  setCardOrderPayload,
  setCardOrderPinPayload,
  setCardOrdersPage,
  setCardOrderStatusPayload,
  setCardOrderValidationPayload,
  setProfileFilter,
  t,
  timeZone,
}: WiseCardOrdersTabContentProps) {
  return (
    <TabsContent value="card-orders" className="space-y-4 mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardDescription>{t('wise.cardOrders.subtitle')}</CardDescription>
        <WiseCardOrdersToolbar
          cardOrdersPage={cardOrdersPage}
          onRefreshCardOrders={onRefreshCardOrders}
          profileFilter={profileFilter}
          profiles={profiles}
          setCardOrdersPage={setCardOrdersPage}
          setProfileFilter={setProfileFilter}
          t={t}
        />
      </div>

      <WiseCardOrdersCreateCard
        cardOrderPayload={cardOrderPayload}
        isPendingCardOrderCreate={isPendingCardOrderCreate}
        onCreateCardOrder={onCreateCardOrder}
        setCardOrderPayload={setCardOrderPayload}
        t={t}
      />

      <WiseCardOrdersActionsCard
        cardOrderAvailability={cardOrderAvailability}
        cardOrderDetails={cardOrderDetails}
        cardOrderId={cardOrderId}
        cardOrderPinPayload={cardOrderPinPayload}
        cardOrderRequirements={cardOrderRequirements}
        cardOrderStatusPayload={cardOrderStatusPayload}
        cardOrderValidationPayload={cardOrderValidationPayload}
        isPendingCardOrderAvailability={isPendingCardOrderAvailability}
        isPendingCardOrderPin={isPendingCardOrderPin}
        isPendingCardOrderStatusUpdate={isPendingCardOrderStatusUpdate}
        isPendingCardOrderValidateAddress={isPendingCardOrderValidateAddress}
        onFetchCardOrderAvailability={onFetchCardOrderAvailability}
        onFetchCardOrderDetails={onFetchCardOrderDetails}
        onFetchCardOrderRequirements={onFetchCardOrderRequirements}
        onSetCardOrderPin={onSetCardOrderPin}
        onUpdateCardOrderStatus={onUpdateCardOrderStatus}
        onValidateCardOrderAddress={onValidateCardOrderAddress}
        setCardOrderId={setCardOrderId}
        setCardOrderPinPayload={setCardOrderPinPayload}
        setCardOrderStatusPayload={setCardOrderStatusPayload}
        setCardOrderValidationPayload={setCardOrderValidationPayload}
        t={t}
      />

      <WiseCardOrdersListCard
        cardOrders={cardOrders}
        formatDate={formatDate}
        isLoadingCardOrders={isLoadingCardOrders}
        locale={locale}
        profileFilter={profileFilter}
        t={t}
        timeZone={timeZone}
      />
    </TabsContent>
  );
}
