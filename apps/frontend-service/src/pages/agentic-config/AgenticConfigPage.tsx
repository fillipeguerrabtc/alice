import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { AgenticConfigTabs } from './AgenticConfigTabs';
import { DetectorGroupEditor } from './components/DetectorGroupEditor';
import { ExecutionScopeToggles } from './components/ExecutionScopeToggles';
import { KeywordTextareaField } from './components/KeywordTextareaField';
import { ModuleHeaderCard } from './components/ModuleHeaderCard';
import {
  ModuleNamespaceBindingsEditor,
  NamespaceRoutingEditor,
} from './components/NamespaceRoutingEditor';
import { PlatformLinksEditor } from './components/PlatformLinksEditor';
import {
  agenticSettingsSchema,
  buildAgenticDefaultValues,
  type AgenticModuleTab,
  type AgenticSettingsForm,
  type AgenticSettingsResponse,
} from './types';

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function mergeSettings(settings: AgenticSettingsForm | undefined, defaults: AgenticSettingsForm | undefined): AgenticSettingsForm {
  const base = buildAgenticDefaultValues();
  const resolvedDefaults = defaults ?? base;
  const resolvedSettings = settings ?? resolvedDefaults;

  return {
    ...base,
    ...resolvedDefaults,
    ...resolvedSettings,
    detectors: {
      ...base.detectors,
      ...resolvedDefaults.detectors,
      ...resolvedSettings.detectors,
      namespaceRouting: {
        ...base.detectors.namespaceRouting,
        ...resolvedDefaults.detectors.namespaceRouting,
        ...resolvedSettings.detectors?.namespaceRouting,
        perNamespace: {
          ...base.detectors.namespaceRouting.perNamespace,
          ...(resolvedDefaults.detectors.namespaceRouting?.perNamespace ?? {}),
          ...(resolvedSettings.detectors?.namespaceRouting?.perNamespace ?? {}),
        },
        moduleBindings: {
          ...base.detectors.namespaceRouting.moduleBindings,
          ...(resolvedDefaults.detectors.namespaceRouting?.moduleBindings ?? {}),
          ...(resolvedSettings.detectors?.namespaceRouting?.moduleBindings ?? {}),
        },
      },
    },
    platformLinks: resolvedSettings.platformLinks ?? resolvedDefaults.platformLinks ?? [],
  };
}

function getModuleHints(
  t: (key: string, options?: Record<string, unknown>) => unknown,
  module: AgenticModuleTab
): { examples: string[]; practices: string[] } {
  const examplesRaw = t(`agenticConfig.moduleHints.${module}.examples`, { returnObjects: true });
  const practicesRaw = t(`agenticConfig.moduleHints.${module}.practices`, { returnObjects: true });
  return {
    examples: asStringArray(examplesRaw),
    practices: asStringArray(practicesRaw),
  };
}

export default function AgenticConfigPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<AgenticModuleTab>('overview');
  const form = useForm<AgenticSettingsForm>({
    resolver: zodResolver(agenticSettingsSchema),
    defaultValues: buildAgenticDefaultValues(),
  });

  const settingsQuery = useQuery<AgenticSettingsResponse>({
    queryKey: ['/api/agentic/settings'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/agentic/settings');
      return response.json();
    },
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    const merged = mergeSettings(settingsQuery.data.settings, settingsQuery.data.defaults);
    form.reset(merged);
  }, [settingsQuery.data, form]);

  const mutation = useMutation({
    mutationFn: async (values: AgenticSettingsForm) => {
      const response = await apiRequest('PATCH', '/api/agentic/settings', values);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t('agenticConfig.saveSuccess'),
        description: t('agenticConfig.saveSuccessDesc'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/agentic/settings'] });
    },
    onError: (error: Error) => {
      toast({
        title: t('agenticConfig.saveError'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const mergedDefaults = useMemo(
    () => mergeSettings(settingsQuery.data?.defaults, settingsQuery.data?.defaults),
    [settingsQuery.data?.defaults]
  );

  const restoreModuleDefaults = (module: AgenticModuleTab) => {
    const defaults = mergedDefaults;
    switch (module) {
      case 'overview':
        form.setValue('webEnabled', defaults.webEnabled, { shouldDirty: true, shouldValidate: true });
        form.setValue('erpReadEnabled', defaults.erpReadEnabled, { shouldDirty: true, shouldValidate: true });
        form.setValue('erpWriteEnabled', defaults.erpWriteEnabled, { shouldDirty: true, shouldValidate: true });
        form.setValue('observabilityReadEnabled', defaults.observabilityReadEnabled, { shouldDirty: true, shouldValidate: true });
        form.setValue('observabilityWriteEnabled', defaults.observabilityWriteEnabled, { shouldDirty: true, shouldValidate: true });
        form.setValue('tradingEnabled', defaults.tradingEnabled, { shouldDirty: true, shouldValidate: true });
        form.setValue('paymentsEnabled', defaults.paymentsEnabled, { shouldDirty: true, shouldValidate: true });
        form.setValue('stackOpsEnabled', defaults.stackOpsEnabled, { shouldDirty: true, shouldValidate: true });
        form.setValue('financialApprovalRequired', defaults.financialApprovalRequired, { shouldDirty: true, shouldValidate: true });
        break;
      case 'web':
        form.setValue('detectors.webSearch', defaults.detectors.webSearch, { shouldDirty: true, shouldValidate: true });
        form.setValue('detectors.deepWeb', defaults.detectors.deepWeb, { shouldDirty: true, shouldValidate: true });
        form.setValue('detectors.namespaceRouting.moduleBindings.web', defaults.detectors.namespaceRouting.moduleBindings.web, { shouldDirty: true, shouldValidate: true });
        break;
      case 'images':
        form.setValue('detectors.webImageSearch', defaults.detectors.webImageSearch, { shouldDirty: true, shouldValidate: true });
        form.setValue('detectors.imageGeneration', defaults.detectors.imageGeneration, { shouldDirty: true, shouldValidate: true });
        form.setValue('detectors.namespaceRouting.moduleBindings.images', defaults.detectors.namespaceRouting.moduleBindings.images, { shouldDirty: true, shouldValidate: true });
        break;
      case 'tasks':
        form.setValue('detectors.agenticTask', defaults.detectors.agenticTask, { shouldDirty: true, shouldValidate: true });
        form.setValue('detectors.namespaceRouting.moduleBindings.tasks', defaults.detectors.namespaceRouting.moduleBindings.tasks, { shouldDirty: true, shouldValidate: true });
        break;
      case 'routing':
        form.setValue('detectors.agentRouting', defaults.detectors.agentRouting, { shouldDirty: true, shouldValidate: true });
        form.setValue('detectors.namespaceRouting.moduleBindings.routing', defaults.detectors.namespaceRouting.moduleBindings.routing, { shouldDirty: true, shouldValidate: true });
        break;
      case 'namespaces':
        form.setValue('detectors.namespaceRouting', defaults.detectors.namespaceRouting, { shouldDirty: true, shouldValidate: true });
        break;
      case 'erpnext':
        form.setValue('detectors.erp', defaults.detectors.erp, { shouldDirty: true, shouldValidate: true });
        form.setValue('detectors.namespaceRouting.moduleBindings.erpnext', defaults.detectors.namespaceRouting.moduleBindings.erpnext, { shouldDirty: true, shouldValidate: true });
        break;
      case 'grafana':
        form.setValue('detectors.grafana', defaults.detectors.grafana, { shouldDirty: true, shouldValidate: true });
        form.setValue('detectors.namespaceRouting.moduleBindings.grafana', defaults.detectors.namespaceRouting.moduleBindings.grafana, { shouldDirty: true, shouldValidate: true });
        break;
      case 'payments':
        form.setValue('detectors.payments', defaults.detectors.payments, { shouldDirty: true, shouldValidate: true });
        form.setValue('detectors.namespaceRouting.moduleBindings.payments', defaults.detectors.namespaceRouting.moduleBindings.payments, { shouldDirty: true, shouldValidate: true });
        break;
      case 'stackOps':
        form.setValue('detectors.stackOps', defaults.detectors.stackOps, { shouldDirty: true, shouldValidate: true });
        form.setValue('detectors.namespaceRouting.moduleBindings.stackOps', defaults.detectors.namespaceRouting.moduleBindings.stackOps, { shouldDirty: true, shouldValidate: true });
        break;
      case 'links':
        form.setValue('platformLinks', defaults.platformLinks, { shouldDirty: true, shouldValidate: true });
        break;
      case 'trading':
        form.setValue('detectors.trading', defaults.detectors.trading, { shouldDirty: true, shouldValidate: true });
        form.setValue('detectors.namespaceRouting.moduleBindings.trading', defaults.detectors.namespaceRouting.moduleBindings.trading, { shouldDirty: true, shouldValidate: true });
        break;
      default:
        break;
    }
  };

  const onSubmit = (values: AgenticSettingsForm) => {
    mutation.mutate(values);
  };

  if (settingsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const moduleHints = {
    overview: getModuleHints(t, 'overview'),
    web: getModuleHints(t, 'web'),
    images: getModuleHints(t, 'images'),
    tasks: getModuleHints(t, 'tasks'),
    routing: getModuleHints(t, 'routing'),
    namespaces: getModuleHints(t, 'namespaces'),
    erpnext: getModuleHints(t, 'erpnext'),
    grafana: getModuleHints(t, 'grafana'),
    payments: getModuleHints(t, 'payments'),
    stackOps: getModuleHints(t, 'stackOps'),
    links: getModuleHints(t, 'links'),
    trading: getModuleHints(t, 'trading'),
  };

  const moduleHeaderMeta = (module: AgenticModuleTab) => ({
    examplesTitle: t('agenticConfig.examplesTitle'),
    practicesTitle: t('agenticConfig.bestPracticesTitle'),
    restoreLabel: t('agenticConfig.restoreModuleDefaults'),
    examples: moduleHints[module].examples,
    practices: moduleHints[module].practices,
  });

  const contentByTab: Record<AgenticModuleTab, ReactNode> = {
    overview: (
      <div className="space-y-6">
        <ModuleHeaderCard
          title={t('agenticConfig.tabs.overview')}
          description={t('agenticConfig.moduleDescriptions.overview')}
          onRestoreDefaults={() => restoreModuleDefaults('overview')}
          {...moduleHeaderMeta('overview')}
        />
        <ExecutionScopeToggles form={form} />
      </div>
    ),
    web: (
      <div className="space-y-6">
        <ModuleHeaderCard
          title={t('agenticConfig.tabs.web')}
          description={t('agenticConfig.moduleDescriptions.web')}
          onRestoreDefaults={() => restoreModuleDefaults('web')}
          {...moduleHeaderMeta('web')}
        />
        <ModuleNamespaceBindingsEditor
          form={form}
          moduleKey="web"
          title={t('agenticConfig.namespaceBindings.title')}
          description={t('agenticConfig.namespaceBindings.description')}
        />
        <Card>
          <CardContent className="space-y-6 pt-6">
            <DetectorGroupEditor
              control={form.control}
              title={t('agenticConfig.detectorsWebTitle')}
              description={t('agenticConfig.detectorsWebDesc')}
              fields={[
                { name: 'detectors.webSearch.keywords', label: t('agenticConfig.webKeywords'), placeholder: t('agenticConfig.webKeywordsPlaceholder') },
                { name: 'detectors.webSearch.patterns', label: t('agenticConfig.webPatterns'), placeholder: t('agenticConfig.webPatternsPlaceholder'), validateRegex: true },
                { name: 'detectors.deepWeb.keywords', label: t('agenticConfig.deepWebKeywords'), placeholder: t('agenticConfig.deepWebKeywordsPlaceholder') },
                { name: 'detectors.deepWeb.patterns', label: t('agenticConfig.deepWebPatterns'), placeholder: t('agenticConfig.deepWebPatternsPlaceholder'), validateRegex: true },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    ),
    images: (
      <div className="space-y-6">
        <ModuleHeaderCard
          title={t('agenticConfig.tabs.images')}
          description={t('agenticConfig.moduleDescriptions.images')}
          onRestoreDefaults={() => restoreModuleDefaults('images')}
          {...moduleHeaderMeta('images')}
        />
        <ModuleNamespaceBindingsEditor
          form={form}
          moduleKey="images"
          title={t('agenticConfig.namespaceBindings.title')}
          description={t('agenticConfig.namespaceBindings.description')}
        />
        <Card>
          <CardContent className="space-y-6 pt-6">
            <DetectorGroupEditor
              control={form.control}
              title={t('agenticConfig.detectorsImagesTitle')}
              description={t('agenticConfig.detectorsImagesDesc')}
              fields={[
                { name: 'detectors.webImageSearch.keywords', label: t('agenticConfig.webImageKeywords'), placeholder: t('agenticConfig.webImageKeywordsPlaceholder') },
                { name: 'detectors.webImageSearch.patterns', label: t('agenticConfig.webImagePatterns'), placeholder: t('agenticConfig.webImagePatternsPlaceholder'), validateRegex: true },
                { name: 'detectors.imageGeneration.keywords', label: t('agenticConfig.imageGenKeywords'), placeholder: t('agenticConfig.imageGenKeywordsPlaceholder') },
                { name: 'detectors.imageGeneration.patterns', label: t('agenticConfig.imageGenPatterns'), placeholder: t('agenticConfig.imageGenPatternsPlaceholder'), validateRegex: true },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    ),
    tasks: (
      <div className="space-y-6">
        <ModuleHeaderCard
          title={t('agenticConfig.tabs.tasks')}
          description={t('agenticConfig.moduleDescriptions.tasks')}
          onRestoreDefaults={() => restoreModuleDefaults('tasks')}
          {...moduleHeaderMeta('tasks')}
        />
        <ModuleNamespaceBindingsEditor
          form={form}
          moduleKey="tasks"
          title={t('agenticConfig.namespaceBindings.title')}
          description={t('agenticConfig.namespaceBindings.description')}
        />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <KeywordTextareaField control={form.control} name="detectors.agenticTask.createKeywords" label={t('agenticConfig.taskCreateKeywords')} placeholder={t('agenticConfig.taskCreateKeywordsPlaceholder')} rows={3} />
            <KeywordTextareaField control={form.control} name="detectors.agenticTask.updateKeywords" label={t('agenticConfig.taskUpdateKeywords')} placeholder={t('agenticConfig.taskUpdateKeywordsPlaceholder')} rows={3} />
            <KeywordTextareaField control={form.control} name="detectors.agenticTask.intentKeywords" label={t('agenticConfig.taskIntentKeywords')} placeholder={t('agenticConfig.taskIntentKeywordsPlaceholder')} rows={3} />
            <div className="grid gap-4 md:grid-cols-2">
              <KeywordTextareaField control={form.control} name="detectors.agenticTask.typeKeywords.document" label={t('agenticConfig.taskTypeDocument')} placeholder={t('agenticConfig.taskTypePlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.agenticTask.typeKeywords.report" label={t('agenticConfig.taskTypeReport')} placeholder={t('agenticConfig.taskTypePlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.agenticTask.typeKeywords.accounting" label={t('agenticConfig.taskTypeAccounting')} placeholder={t('agenticConfig.taskTypePlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.agenticTask.typeKeywords.planning" label={t('agenticConfig.taskTypePlanning')} placeholder={t('agenticConfig.taskTypePlaceholder')} rows={3} />
            </div>
          </CardContent>
        </Card>
      </div>
    ),
    routing: (
      <div className="space-y-6">
        <ModuleHeaderCard
          title={t('agenticConfig.tabs.routing')}
          description={t('agenticConfig.moduleDescriptions.routing')}
          onRestoreDefaults={() => restoreModuleDefaults('routing')}
          {...moduleHeaderMeta('routing')}
        />
        <ModuleNamespaceBindingsEditor
          form={form}
          moduleKey="routing"
          title={t('agenticConfig.namespaceBindings.title')}
          description={t('agenticConfig.namespaceBindings.description')}
        />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <KeywordTextareaField control={form.control} name="detectors.agentRouting.manualKeywords" label={t('agenticConfig.agentRoutingManualKeywords')} placeholder={t('agenticConfig.agentRoutingKeywordsPlaceholder')} rows={3} />
            <KeywordTextareaField control={form.control} name="detectors.agentRouting.autoKeywords" label={t('agenticConfig.agentRoutingAutoKeywords')} placeholder={t('agenticConfig.agentRoutingKeywordsPlaceholder')} rows={3} />
          </CardContent>
        </Card>
      </div>
    ),
    namespaces: (
      <div className="space-y-6">
        <ModuleHeaderCard
          title={t('agenticConfig.tabs.namespaces')}
          description={t('agenticConfig.moduleDescriptions.namespaces')}
          onRestoreDefaults={() => restoreModuleDefaults('namespaces')}
          {...moduleHeaderMeta('namespaces')}
        />
        <Card>
          <CardContent className="pt-6">
            <NamespaceRoutingEditor form={form} defaults={mergedDefaults.detectors.namespaceRouting} />
          </CardContent>
        </Card>
      </div>
    ),
    erpnext: (
      <div className="space-y-6">
        <ModuleHeaderCard
          title={t('agenticConfig.tabs.erpnext')}
          description={t('agenticConfig.moduleDescriptions.erpnext')}
          onRestoreDefaults={() => restoreModuleDefaults('erpnext')}
          {...moduleHeaderMeta('erpnext')}
        />
        <ModuleNamespaceBindingsEditor
          form={form}
          moduleKey="erpnext"
          title={t('agenticConfig.namespaceBindings.title')}
          description={t('agenticConfig.namespaceBindings.description')}
        />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <KeywordTextareaField control={form.control} name="detectors.erp.baseKeywords" label={t('agenticConfig.erpBaseKeywords')} placeholder={t('agenticConfig.erpBaseKeywordsPlaceholder')} rows={3} />
            <div className="grid gap-4 md:grid-cols-2">
              <KeywordTextareaField control={form.control} name="detectors.erp.listItemsKeywords" label={t('agenticConfig.erpItemsKeywords')} placeholder={t('agenticConfig.erpKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.erp.listCustomersKeywords" label={t('agenticConfig.erpCustomersKeywords')} placeholder={t('agenticConfig.erpKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.erp.listInvoicesKeywords" label={t('agenticConfig.erpInvoicesKeywords')} placeholder={t('agenticConfig.erpKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.erp.annualBillingKeywords" label={t('agenticConfig.erpAnnualBillingKeywords')} placeholder={t('agenticConfig.erpKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.erp.createCustomerKeywords" label={t('agenticConfig.erpCreateCustomerKeywords')} placeholder={t('agenticConfig.erpKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.erp.createInvoiceKeywords" label={t('agenticConfig.erpCreateInvoiceKeywords')} placeholder={t('agenticConfig.erpKeywordsPlaceholder')} rows={3} />
            </div>
          </CardContent>
        </Card>
      </div>
    ),
    grafana: (
      <div className="space-y-6">
        <ModuleHeaderCard
          title={t('agenticConfig.tabs.grafana')}
          description={t('agenticConfig.moduleDescriptions.grafana')}
          onRestoreDefaults={() => restoreModuleDefaults('grafana')}
          {...moduleHeaderMeta('grafana')}
        />
        <ModuleNamespaceBindingsEditor
          form={form}
          moduleKey="grafana"
          title={t('agenticConfig.namespaceBindings.title')}
          description={t('agenticConfig.namespaceBindings.description')}
        />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <KeywordTextareaField control={form.control} name="detectors.grafana.baseKeywords" label={t('agenticConfig.grafanaBaseKeywords')} placeholder={t('agenticConfig.grafanaBaseKeywordsPlaceholder')} rows={3} />
            <div className="grid gap-4 md:grid-cols-2">
              <KeywordTextareaField control={form.control} name="detectors.grafana.listDashboardsKeywords" label={t('agenticConfig.grafanaListKeywords')} placeholder={t('agenticConfig.grafanaKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.grafana.getDashboardKeywords" label={t('agenticConfig.grafanaGetKeywords')} placeholder={t('agenticConfig.grafanaKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.grafana.updateDashboardKeywords" label={t('agenticConfig.grafanaUpdateKeywords')} placeholder={t('agenticConfig.grafanaKeywordsPlaceholder')} rows={3} />
            </div>
          </CardContent>
        </Card>
      </div>
    ),
    payments: (
      <div className="space-y-6">
        <ModuleHeaderCard
          title={t('agenticConfig.tabs.payments')}
          description={t('agenticConfig.moduleDescriptions.payments')}
          onRestoreDefaults={() => restoreModuleDefaults('payments')}
          {...moduleHeaderMeta('payments')}
        />
        <ModuleNamespaceBindingsEditor
          form={form}
          moduleKey="payments"
          title={t('agenticConfig.namespaceBindings.title')}
          description={t('agenticConfig.namespaceBindings.description')}
        />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <KeywordTextareaField control={form.control} name="detectors.payments.wiseKeywords" label={t('agenticConfig.wiseKeywords')} placeholder={t('agenticConfig.wiseKeywordsPlaceholder')} rows={3} />
            <div className="grid gap-4 md:grid-cols-2">
              <KeywordTextareaField control={form.control} name="detectors.payments.wiseRecipientsKeywords" label={t('agenticConfig.wiseRecipientsKeywords')} placeholder={t('agenticConfig.paymentsKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.payments.wiseTransferKeywords" label={t('agenticConfig.wiseTransferKeywords')} placeholder={t('agenticConfig.paymentsKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.payments.wiseExchangeKeywords" label={t('agenticConfig.wiseExchangeKeywords')} placeholder={t('agenticConfig.paymentsKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.payments.stripeKeywords" label={t('agenticConfig.stripeKeywords')} placeholder={t('agenticConfig.paymentsKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.payments.stripePaymentKeywords" label={t('agenticConfig.stripePaymentKeywords')} placeholder={t('agenticConfig.paymentsKeywordsPlaceholder')} rows={3} />
            </div>
          </CardContent>
        </Card>
      </div>
    ),
    stackOps: (
      <div className="space-y-6">
        <ModuleHeaderCard
          title={t('agenticConfig.tabs.stackOps')}
          description={t('agenticConfig.moduleDescriptions.stackOps')}
          onRestoreDefaults={() => restoreModuleDefaults('stackOps')}
          {...moduleHeaderMeta('stackOps')}
        />
        <ModuleNamespaceBindingsEditor
          form={form}
          moduleKey="stackOps"
          title={t('agenticConfig.namespaceBindings.title')}
          description={t('agenticConfig.namespaceBindings.description')}
        />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <KeywordTextareaField control={form.control} name="detectors.stackOps.baseKeywords" label={t('agenticConfig.stackBaseKeywords')} placeholder={t('agenticConfig.stackBaseKeywordsPlaceholder')} rows={3} />
            <div className="grid gap-4 md:grid-cols-2">
              <KeywordTextareaField control={form.control} name="detectors.stackOps.deployKeywords" label={t('agenticConfig.stackDeployKeywords')} placeholder={t('agenticConfig.stackKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.stackOps.rollbackKeywords" label={t('agenticConfig.stackRollbackKeywords')} placeholder={t('agenticConfig.stackKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.stackOps.dryRunKeywords" label={t('agenticConfig.stackDryRunKeywords')} placeholder={t('agenticConfig.stackKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.stackOps.smartDeployKeywords" label={t('agenticConfig.stackSmartDeployKeywords')} placeholder={t('agenticConfig.stackKeywordsPlaceholder')} rows={3} />
              <KeywordTextareaField control={form.control} name="detectors.stackOps.stackKeywords" label={t('agenticConfig.stackKeywords')} placeholder={t('agenticConfig.stackKeywordsPlaceholder')} rows={3} />
            </div>
          </CardContent>
        </Card>
      </div>
    ),
    links: (
      <div className="space-y-6">
        <ModuleHeaderCard
          title={t('agenticConfig.tabs.links')}
          description={t('agenticConfig.moduleDescriptions.links')}
          onRestoreDefaults={() => restoreModuleDefaults('links')}
          {...moduleHeaderMeta('links')}
        />
        <PlatformLinksEditor form={form} />
      </div>
    ),
    trading: (
      <div className="space-y-6">
        <ModuleHeaderCard
          title={t('agenticConfig.tabs.trading')}
          description={t('agenticConfig.moduleDescriptions.trading')}
          onRestoreDefaults={() => restoreModuleDefaults('trading')}
          {...moduleHeaderMeta('trading')}
        />
        <ModuleNamespaceBindingsEditor
          form={form}
          moduleKey="trading"
          title={t('agenticConfig.namespaceBindings.title')}
          description={t('agenticConfig.namespaceBindings.description')}
        />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <KeywordTextareaField control={form.control} name="detectors.trading.keywords" label={t('agenticConfig.tradingKeywords')} placeholder={t('agenticConfig.tradingKeywordsPlaceholder')} rows={3} />
            <KeywordTextareaField control={form.control} name="detectors.trading.patterns" label={t('agenticConfig.tradingPatterns')} placeholder={t('agenticConfig.tradingPatternsPlaceholder')} rows={3} validateRegex />
          </CardContent>
        </Card>
      </div>
    ),
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('agenticConfig.title')}</h1>
        <p className="text-muted-foreground">{t('agenticConfig.subtitle')}</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <AgenticConfigTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            contentByTab={contentByTab}
          />

          <div className="flex justify-end">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('agenticConfig.saving') : t('agenticConfig.save')}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
