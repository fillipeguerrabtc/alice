import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TabsContent } from '@/components/ui/tabs';
import { WiseDisputeFlowCard } from './wise-dispute-flow-card';
import { WiseDisputeStatusUpdateCard } from './wise-dispute-status-update-card';
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

      <Card>
        <CardHeader>
          <CardTitle>{t('wise.disputes.reasonsTitle')}</CardTitle>
          <CardDescription>{t('wise.disputes.reasonsSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoadingDisputeReasons ? (
            <Skeleton className="h-32" />
          ) : (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
              {disputeReasonsData ? JSON.stringify(disputeReasonsData, null, 2) : t('wise.disputes.noReasons')}
            </pre>
          )}
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <CardTitle>{t('wise.disputes.uploadTitle')}</CardTitle>
          <CardDescription>{t('wise.disputes.uploadSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="file"
            onChange={(event) => onDisputeFileChange(event.target.files?.[0] ?? null)}
            data-testid="input-dispute-file"
          />
          <Button onClick={onDisputeFileUpload} disabled={isPendingDisputeFileUpload} data-testid="button-dispute-upload">
            {t('wise.disputes.upload')}
          </Button>
        </CardContent>
      </Card>

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
