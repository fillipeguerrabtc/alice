import { useMemo } from 'react';
import { Activity, Brain, FileCheck2, Wallet } from 'lucide-react';
import {
  TradingAccountTabContent,
  TradingChartTabContent,
  TradingControlTabContent,
  TradingHeaderSection,
  TradingOperationalAlerts,
  TradingOrderBookTabContent,
  TradingOrdersTabContent,
  TradingPositionsTabContent,
  buildTradingPageSectionProps,
  type TradingTabKey,
  type TradingWorkspaceKey,
} from '@/components/trading';
import {
  TradingWorkspaceAiSignalsCockpitMode,
  TradingWorkspaceCompactOrderTicket,
  TradingWorkspaceOperateMode,
  TradingWorkspaceOperateStatusCard,
  TradingWorkspaceShell,
} from '@/components/trading-v2';

type TradingSectionProps = ReturnType<typeof buildTradingPageSectionProps>;

type TradingV2WorkspaceViewProps = Pick<
  TradingSectionProps,
  | 'headerSectionProps'
  | 'operationalAlertsSectionProps'
  | 'operationalTabsSectionProps'
  | 'primaryTabsSectionProps'
  | 'statsSecondarySectionProps'
> & {
  activeTab: TradingTabKey;
  activeWorkspace: TradingWorkspaceKey;
  engineHealth: 'healthy' | 'degraded' | 'offline';
  onTabChange: (tab: TradingTabKey) => void;
  onWorkspaceChange: (workspace: TradingWorkspaceKey) => void;
  riskModeLabel: string;
  showOperationalAlerts: boolean;
  workspaceOptions: Parameters<typeof TradingWorkspaceShell>[0]['workspaceOptions'];
  visibleTabOptions: Array<{ value: TradingTabKey }>;
};

type TradingWorkspacePrimaryMode =
  | 'operate'
  | 'ai-signals'
  | 'portfolio-auto'
  | 'post-trade';

type TradingWorkspacePrimaryModeOption = Parameters<typeof TradingWorkspaceShell>[0]['modeOptions'][number];

const TRADING_V2_MODE_OPTIONS: TradingWorkspacePrimaryModeOption[] = [
  {
    value: 'operate',
    label: 'Operar',
    description: 'Execução manual, ordens e posições.',
    icon: Activity,
  },
  {
    value: 'ai-signals',
    label: 'Sinais IA',
    description: 'Geração de sinais, análise e validação.',
    icon: Brain,
  },
  {
    value: 'portfolio-auto',
    label: 'Portfólio Auto',
    description: 'Auto-run e coordenação de portfólios.',
    icon: Wallet,
  },
  {
    value: 'post-trade',
    label: 'Pós-trade',
    description: 'Histórico operacional e auditoria.',
    icon: FileCheck2,
  },
];

const TRADING_V2_MODE_TAB_TARGETS: Record<TradingWorkspacePrimaryMode, TradingTabKey[]> = {
  operate: ['overview', 'orders', 'positions'],
  'ai-signals': ['signals-auto', 'signals', 'analysis'],
  'portfolio-auto': ['portfolio-auto'],
  'post-trade': ['history'],
};

const TRADING_V2_TAB_TO_MODE: Partial<Record<TradingTabKey, TradingWorkspacePrimaryMode>> = {
  overview: 'operate',
  orders: 'operate',
  positions: 'operate',
  'signals-auto': 'ai-signals',
  signals: 'ai-signals',
  analysis: 'ai-signals',
  'portfolio-auto': 'portfolio-auto',
  history: 'post-trade',
  chart: 'operate',
  orderbook: 'operate',
  postmortems: 'post-trade',
  account: 'post-trade',
  control: 'post-trade',
  lab: 'ai-signals',
};

function resolveTradingV2PrimaryMode(tab: TradingTabKey): TradingWorkspacePrimaryMode {
  return TRADING_V2_TAB_TO_MODE[tab] ?? 'operate';
}

export function TradingV2WorkspaceView({
  activeTab,
  activeWorkspace,
  engineHealth,
  headerSectionProps,
  onTabChange,
  onWorkspaceChange,
  operationalAlertsSectionProps,
  operationalTabsSectionProps,
  primaryTabsSectionProps,
  riskModeLabel,
  showOperationalAlerts,
  statsSecondarySectionProps,
  visibleTabOptions,
  workspaceOptions,
}: TradingV2WorkspaceViewProps) {
  const activePrimaryMode = resolveTradingV2PrimaryMode(activeTab);
  const isOperateMode = activePrimaryMode === 'operate';
  const isAiSignalsMode = activePrimaryMode === 'ai-signals';
  const visibleTabValues = useMemo(
    () => new Set(visibleTabOptions.map((tab) => tab.value)),
    [visibleTabOptions],
  );

  const sidebarSections = useMemo(
    () => [
      {
        id: 'risk-account',
        title: 'Risk & Account',
        description: 'Controles de risco e governança de conta fora da navegação principal.',
        actions: [
          {
            id: 'risk-account-open',
            label: 'Conta e risco',
            description: 'Acessar limites, saldos e regras operacionais.',
            onSelect: () => onTabChange('account'),
          },
        ],
      },
      {
        id: 'research-governance',
        title: 'Research & Governance',
        description: 'Capacidades avançadas acessadas por progressive disclosure.',
        actions: [
          {
            id: 'research-open',
            label: 'Lab / Research',
            description: 'Explorar hipóteses e validações de pesquisa.',
            onSelect: () => onTabChange('lab'),
          },
          {
            id: 'governance-open',
            label: 'Governança operacional',
            description: 'Abrir histórico de controles e handoff.',
            onSelect: () => onTabChange('control'),
          },
        ],
      },
    ],
    [onTabChange],
  );

  const bottomTraySections = useMemo(
    () => [
      {
        id: 'advanced-market',
        title: 'Mercado avançado',
        description: 'Ferramentas de profundidade e contexto de execução.',
        actions: [
          {
            id: 'advanced-order-book',
            label: 'Advanced order book',
            description: 'Abrir profundidade detalhada de livro de ofertas.',
            onSelect: () => onTabChange('orderbook'),
          },
          {
            id: 'chart-open',
            label: 'Chart avançado',
            description: 'Abrir chart operacional completo.',
            onSelect: () => onTabChange('chart'),
          },
        ],
      },
      {
        id: 'post-trade',
        title: 'Pós-trade avançado',
        description: 'Auditoria detalhada sem poluir o fluxo principal.',
        actions: [
          {
            id: 'postmortem-detail-open',
            label: 'Postmortem detail',
            description: 'Abrir post-mortems detalhados para revisão.',
            onSelect: () => onTabChange('postmortems'),
          },
          {
            id: 'history-open',
            label: 'Histórico completo',
            description: 'Acessar histórico de ordens e decisões.',
            onSelect: () => onTabChange('history'),
          },
        ],
      },
    ],
    [onTabChange],
  );

  const handlePrimaryModeChange = (mode: TradingWorkspacePrimaryMode) => {
    const targetTab = TRADING_V2_MODE_TAB_TARGETS[mode].find((tab) => visibleTabValues.has(tab))
      ?? TRADING_V2_MODE_TAB_TARGETS[mode][0]
      ?? visibleTabOptions[0]?.value;

    if (!targetTab) {
      return;
    }

    onTabChange(targetTab);
  };

  const handleWorkspaceChange = (workspace: string) => {
    onWorkspaceChange(workspace as TradingWorkspaceKey);
  };

  return (
    <>
      {showOperationalAlerts ? (
        <TradingOperationalAlerts {...operationalAlertsSectionProps} />
      ) : null}
      <TradingHeaderSection {...headerSectionProps} />

      <TradingWorkspaceShell
        activeMode={activePrimaryMode}
        activeWorkspace={activeWorkspace}
        bottomTraySections={bottomTraySections}
        environmentMode="real"
        modeOptions={TRADING_V2_MODE_OPTIONS}
        onModeChange={handlePrimaryModeChange}
        onWorkspaceChange={handleWorkspaceChange}
        sidebarSections={sidebarSections}
        workspaceOptions={workspaceOptions}
      >
        {isOperateMode ? (
          <TradingWorkspaceOperateMode
            chartArea={(
              <div className="[&>div]:mt-0">
                <TradingChartTabContent {...operationalTabsSectionProps.chartTabProps} />
              </div>
            )}
            orderTicket={(
              <TradingWorkspaceCompactOrderTicket
                bestAskPrice={primaryTabsSectionProps.overviewTabProps.bestAskPrice}
                bestBidPrice={primaryTabsSectionProps.overviewTabProps.bestBidPrice}
                onOpenNewOrderDialog={primaryTabsSectionProps.overviewTabProps.onOpenNewOrderDialog}
                onOpenOcoOrderDialog={primaryTabsSectionProps.ordersTabProps.onOpenOcoOrderDialog}
                onQuickOrder={primaryTabsSectionProps.overviewTabProps.onQuickOrder}
                selectedSymbol={headerSectionProps.selectedSymbol}
                tradingEnabled={primaryTabsSectionProps.overviewTabProps.tradingEnabled}
              />
            )}
            statusCard={(
              <TradingWorkspaceOperateStatusCard
                circuitBreakerFailures={statsSecondarySectionProps.circuitBreakerFailures}
                circuitBreakerState={statsSecondarySectionProps.circuitBreakerState}
                engineHealth={engineHealth}
                riskMode={riskModeLabel}
                wsConnecting={headerSectionProps.wsConnecting}
                wsEnabled={headerSectionProps.wsEnabled}
                wsHealthy={headerSectionProps.wsHealthy}
              />
            )}
            openPositionsPanel={(
              <div className="[&>div]:mt-0">
                <TradingPositionsTabContent {...primaryTabsSectionProps.positionsTabProps} />
              </div>
            )}
            openOrdersPanel={(
              <div className="[&>div]:mt-0">
                <TradingOrdersTabContent {...primaryTabsSectionProps.ordersTabProps} />
              </div>
            )}
            advancedDisclosure={(
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <div className="[&>div]:mt-0">
                    <TradingAccountTabContent {...operationalTabsSectionProps.accountTabProps} />
                  </div>
                  <div className="[&>div]:mt-0">
                    <TradingControlTabContent {...operationalTabsSectionProps.controlTabProps} />
                  </div>
                </div>
                <div className="[&>div]:mt-0">
                  <TradingOrderBookTabContent {...operationalTabsSectionProps.orderBookTabProps} />
                </div>
              </div>
            )}
          />
        ) : isAiSignalsMode ? (
          <TradingWorkspaceAiSignalsCockpitMode
            activeAutoRunDetail={primaryTabsSectionProps.signalsAutoTabProps.activeAutoRunDetail}
            activeAutoRunId={primaryTabsSectionProps.signalsAutoTabProps.activeAutoRunId}
            allowedModes={primaryTabsSectionProps.signalsAutoTabProps.allowedModes}
            autoMix={primaryTabsSectionProps.signalsAutoTabProps.autoMix}
            autoModeOptions={primaryTabsSectionProps.signalsAutoTabProps.autoModeOptions}
            autoSelectAllAssets={primaryTabsSectionProps.signalsAutoTabProps.autoSelectAllAssets}
            autoSelectedAssetKeys={primaryTabsSectionProps.signalsAutoTabProps.autoSelectedAssetKeys}
            autoSignalAssetOptions={primaryTabsSectionProps.signalsAutoTabProps.autoSignalAssetOptions}
            autoUniverseScope={primaryTabsSectionProps.signalsAutoTabProps.autoUniverseScope}
            canOverrideReasoningMode={primaryTabsSectionProps.signalsAutoTabProps.canOverrideReasoningMode}
            environmentMode="real"
            hasAutoSignalAssetsError={primaryTabsSectionProps.signalsAutoTabProps.hasAutoSignalAssetsError}
            isLoadingAutoSignalAssets={primaryTabsSectionProps.signalsAutoTabProps.isLoadingAutoSignalAssets}
            isLoadingSignals={primaryTabsSectionProps.signalsTabProps.isLoadingSignals}
            locale={primaryTabsSectionProps.signalsAutoTabProps.locale}
            marketType={primaryTabsSectionProps.signalsTabProps.marketType}
            onAllowedModesChange={primaryTabsSectionProps.signalsAutoTabProps.onAllowedModesChange}
            onAutoMixChange={primaryTabsSectionProps.signalsAutoTabProps.onAutoMixChange}
            onAutoSelectAllAssetsChange={primaryTabsSectionProps.signalsAutoTabProps.onAutoSelectAllAssetsChange}
            onAutoSelectedAssetKeysChange={primaryTabsSectionProps.signalsAutoTabProps.onAutoSelectedAssetKeysChange}
            onAutoUniverseScopeChange={primaryTabsSectionProps.signalsAutoTabProps.onAutoUniverseScopeChange}
            onOpenGeneratedSignal={primaryTabsSectionProps.signalsAutoTabProps.onOpenGeneratedSignal}
            onOpenSignalsPanel={primaryTabsSectionProps.signalsAutoTabProps.onOpenSignalsPanel}
            onReasoningModeChange={primaryTabsSectionProps.signalsAutoTabProps.onReasoningModeChange}
            onRunAutoNow={primaryTabsSectionProps.signalsAutoTabProps.onRunAutoNow}
            onSelectAutoRun={primaryTabsSectionProps.signalsAutoTabProps.onSelectAutoRun}
            reasoningMode={primaryTabsSectionProps.signalsAutoTabProps.reasoningMode}
            reasoningModeOptions={primaryTabsSectionProps.signalsAutoTabProps.reasoningModeOptions}
            renderSignalTypeBadge={primaryTabsSectionProps.signalsTabProps.renderSignalTypeBadge}
            selectedSignal={primaryTabsSectionProps.signalsTabProps.selectedSignal}
            signalAutoRunPending={primaryTabsSectionProps.signalsAutoTabProps.signalAutoRunPending}
            signalAutoRuns={primaryTabsSectionProps.signalsAutoTabProps.signalAutoRuns}
            signals={primaryTabsSectionProps.signalsTabProps.signals}
            t={primaryTabsSectionProps.signalsAutoTabProps.t}
            timeZone={primaryTabsSectionProps.signalsAutoTabProps.timeZone}
            topTradingCandidates={primaryTabsSectionProps.signalsAutoTabProps.topTradingCandidates}
          />
        ) : (
          <div className="space-y-4">
            <div className="[&>div]:mt-0">
              <TradingPositionsTabContent {...primaryTabsSectionProps.positionsTabProps} />
            </div>
            <div className="[&>div]:mt-0">
              <TradingOrdersTabContent {...primaryTabsSectionProps.ordersTabProps} />
            </div>
          </div>
        )}
      </TradingWorkspaceShell>
    </>
  );
}
