import { CardDescription } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import { WiseDisputeFlowCard } from './wise-dispute-flow-card';
import { WiseDisputeReasonsCard } from './wise-dispute-reasons-card';
import { WiseDisputeStatusUpdateCard } from './wise-dispute-status-update-card';
import { WiseDisputeUploadCard } from './wise-dispute-upload-card';
import { WiseDisputesListCard } from './wise-disputes-list-card';
import type { WiseDisputesTabContentProps } from './wise-disputes-tab-types';
import { WiseDisputesToolbar } from './wise-disputes-toolbar';

export function WiseDisputesTabContent({
  disputeFlowForm,
  disputeFlowStepResult,
  disputeFlowSubmitResult,
  disputeReasonsData,
  disputeStatusUpdate,
  disputes,
  formatDate,
  isLoadingDisputeReasons,
  isLoadingDisputes,
  isPendingDisputeFlowStep,
  isPendingDisputeFlowSubmit,
  isPendingDisputeFileUpload,
  isPendingDisputeStatusUpdate,
  locale,
  onDisputeFileChange,
  onDisputeFileUpload,
  onDisputeFlowStep,
  onDisputeFlowSubmit,
  onRefreshDisputes,
  onUpdateDisputeStatus,
  profileFilter,
  profiles,
  setDisputeFlowForm,
  setDisputeStatusUpdate,
  setProfileFilter,
  t,
  timeZone,
}: WiseDisputesTabContentProps) {
  return (
    <TabsContent value="disputes" className="space-y-4 mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardDescription>{t('wise.disputes.subtitle')}</CardDescription>
        <WiseDisputesToolbar
          onRefreshDisputes={onRefreshDisputes}
          profileFilter={profileFilter}
          profiles={profiles}
          setProfileFilter={setProfileFilter}
          t={t}
        />
      </div>

      <WiseDisputeReasonsCard
        disputeReasonsData={disputeReasonsData}
        isLoadingDisputeReasons={isLoadingDisputeReasons}
        t={t}
      />

      <WiseDisputeFlowCard
        disputeFlowForm={disputeFlowForm}
        disputeFlowStepResult={disputeFlowStepResult}
        disputeFlowSubmitResult={disputeFlowSubmitResult}
        isPendingDisputeFlowStep={isPendingDisputeFlowStep}
        isPendingDisputeFlowSubmit={isPendingDisputeFlowSubmit}
        onDisputeFlowStep={onDisputeFlowStep}
        onDisputeFlowSubmit={onDisputeFlowSubmit}
        setDisputeFlowForm={setDisputeFlowForm}
        t={t}
      />

      <WiseDisputeUploadCard
        isPendingDisputeFileUpload={isPendingDisputeFileUpload}
        onDisputeFileChange={onDisputeFileChange}
        onDisputeFileUpload={onDisputeFileUpload}
        t={t}
      />

      <WiseDisputeStatusUpdateCard
        disputeStatusUpdate={disputeStatusUpdate}
        isPendingDisputeStatusUpdate={isPendingDisputeStatusUpdate}
        onUpdateDisputeStatus={onUpdateDisputeStatus}
        setDisputeStatusUpdate={setDisputeStatusUpdate}
        t={t}
      />

      <WiseDisputesListCard
        disputes={disputes}
        formatDate={formatDate}
        isLoadingDisputes={isLoadingDisputes}
        locale={locale}
        profileFilter={profileFilter}
        t={t}
        timeZone={timeZone}
      />
    </TabsContent>
  );
}
