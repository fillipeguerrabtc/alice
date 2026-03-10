import { CardDescription } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import { WiseSpendControlsAssignCard } from './wise-spend-controls-assign-card';
import { WiseSpendControlsCreateCard } from './wise-spend-controls-create-card';
import { WiseSpendControlsDeleteCard } from './wise-spend-controls-delete-card';
import { WiseSpendControlsListCard } from './wise-spend-controls-list-card';
import type { WiseSpendControlsTabContentProps } from './wise-spend-controls-tab-types';
import { WiseSpendControlsToolbar } from './wise-spend-controls-toolbar';

export function WiseSpendControlsTabContent({
  assignSpendControlPending,
  createSpendControlPending,
  currencies,
  deleteSpendControlPending,
  formatNumber,
  isLoadingSpendControls,
  locale,
  onAssignSpendControl,
  onCreateSpendControl,
  onDeleteSpendControl,
  onRefreshSpendControls,
  profileFilter,
  profiles,
  setProfileFilter,
  setSpendControlAssignment,
  setSpendControlDeleteId,
  setSpendControlForm,
  spendControlAssignment,
  spendControlDeleteId,
  spendControlForm,
  spendControls,
  t,
  unassignSpendControlPending,
}: WiseSpendControlsTabContentProps) {
  return (
    <TabsContent value="spend-controls" className="space-y-4 mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardDescription>{t('wise.spendControls.subtitle')}</CardDescription>
        <WiseSpendControlsToolbar
          onRefreshSpendControls={onRefreshSpendControls}
          profileFilter={profileFilter}
          profiles={profiles}
          setProfileFilter={setProfileFilter}
          t={t}
        />
      </div>

      <WiseSpendControlsCreateCard
        createSpendControlPending={createSpendControlPending}
        currencies={currencies}
        onCreateSpendControl={onCreateSpendControl}
        setSpendControlForm={setSpendControlForm}
        spendControlForm={spendControlForm}
        t={t}
      />

      <WiseSpendControlsAssignCard
        assignSpendControlPending={assignSpendControlPending}
        onAssignSpendControl={onAssignSpendControl}
        setSpendControlAssignment={setSpendControlAssignment}
        spendControlAssignment={spendControlAssignment}
        t={t}
        unassignSpendControlPending={unassignSpendControlPending}
      />

      <WiseSpendControlsDeleteCard
        deleteSpendControlPending={deleteSpendControlPending}
        onDeleteSpendControl={onDeleteSpendControl}
        setSpendControlDeleteId={setSpendControlDeleteId}
        spendControlDeleteId={spendControlDeleteId}
        t={t}
      />

      <WiseSpendControlsListCard
        formatNumber={formatNumber}
        isLoadingSpendControls={isLoadingSpendControls}
        locale={locale}
        profileFilter={profileFilter}
        spendControls={spendControls}
        t={t}
      />
    </TabsContent>
  );
}
