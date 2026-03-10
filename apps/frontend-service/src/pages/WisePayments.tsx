import { useTranslation } from 'react-i18next';
import {
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { TIMEZONE } from '@/lib/i18n';
import { WisePaymentsTabsShell } from './wise-payments/components/wise-payments-tabs-shell';
import {
  WisePaymentsLoadingState,
  WisePaymentsNotConfiguredState,
} from './wise-payments/components/wise-payments-status-states';
import { WisePaymentsTabsContent } from './wise-payments/components/wise-payments-tabs-content';
import { useWisePageComposition } from './wise-payments/use-wise-page-composition';

export default function WisePayments() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const locale = user?.idioma ?? 'pt-BR';
  const timeZone = user?.timezone ?? TIMEZONE;
  const {
    activeTab,
    activeWorkspace,
    dataQueries,
    handleWiseTabChange,
    handleWiseWorkspaceSelectionChange,
    refreshActions,
    tabsContentProps,
    wiseTabOptions,
    wiseWorkspaceOptions,
  } = useWisePageComposition({
    locale,
    notify: toast,
    t,
    timeZone,
  });

  if (dataQueries.isLoadingStatus) {
    return <WisePaymentsLoadingState />;
  }

  if (!dataQueries.statusData?.configured) {
    return (
      <WisePaymentsNotConfiguredState
        description="Configure WISE_API_KEY e WISE_PROFILE_ID para ativar os pagamentos Wise."
        title={t('wise.notConfigured')}
      />
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-wise-title">{t('wise.title')}</h1>
          <p className="text-muted-foreground">{t('wise.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {dataQueries.statusData?.sandbox && (
            <Badge variant="outline" className="text-yellow-600 border-yellow-600">
              {t('wise.sandbox')}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={refreshActions.handleRefreshWiseData}
            data-testid="button-wise-refresh"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      <WisePaymentsTabsShell
        activeTab={activeTab}
        activeWorkspace={activeWorkspace}
        onTabChange={handleWiseTabChange}
        onWorkspaceChange={handleWiseWorkspaceSelectionChange}
        tabs={wiseTabOptions}
        workspaceOptions={wiseWorkspaceOptions}
      >
        <WisePaymentsTabsContent {...tabsContentProps} />
      </WisePaymentsTabsShell>
    </div>
  );
}

