import { useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';

const agenticLinkSchema = z.object({
  id: z.string().min(4),
  name: z.string().min(2, 'Nome obrigatório'),
  url: z.string().url('URL inválida'),
  description: z.string().max(500).optional().nullable(),
  tags: z.array(z.string().min(1)).optional().nullable(),
});

const agenticSettingsSchema = z.object({
  webEnabled: z.boolean(),
  erpReadEnabled: z.boolean(),
  erpWriteEnabled: z.boolean(),
  tradingEnabled: z.boolean(),
  paymentsEnabled: z.boolean(),
  stackOpsEnabled: z.boolean(),
  financialApprovalRequired: z.boolean(),
  detectors: z.object({
    webSearch: z.object({
      keywords: z.array(z.string().min(1).max(160)).max(200),
      patterns: z.array(z.string().min(1).max(160)).max(200),
    }),
    deepWeb: z.object({
      keywords: z.array(z.string().min(1).max(160)).max(200),
      patterns: z.array(z.string().min(1).max(160)).max(200),
    }),
    webImageSearch: z.object({
      keywords: z.array(z.string().min(1).max(160)).max(200),
      patterns: z.array(z.string().min(1).max(160)).max(200),
    }),
    imageGeneration: z.object({
      keywords: z.array(z.string().min(1).max(160)).max(200),
      patterns: z.array(z.string().min(1).max(160)).max(200),
    }),
    trading: z.object({
      keywords: z.array(z.string().min(1).max(160)).max(200),
      patterns: z.array(z.string().min(1).max(160)).max(200),
    }),
    agenticTask: z.object({
      createKeywords: z.array(z.string().min(1).max(160)).max(200),
      updateKeywords: z.array(z.string().min(1).max(160)).max(200),
      intentKeywords: z.array(z.string().min(1).max(160)).max(200),
      typeKeywords: z.object({
        document: z.array(z.string().min(1).max(160)).max(200),
        report: z.array(z.string().min(1).max(160)).max(200),
        accounting: z.array(z.string().min(1).max(160)).max(200),
        planning: z.array(z.string().min(1).max(160)).max(200),
      }),
    }),
    erp: z.object({
      baseKeywords: z.array(z.string().min(1).max(160)).max(200),
      listItemsKeywords: z.array(z.string().min(1).max(160)).max(200),
      listCustomersKeywords: z.array(z.string().min(1).max(160)).max(200),
      listInvoicesKeywords: z.array(z.string().min(1).max(160)).max(200),
      annualBillingKeywords: z.array(z.string().min(1).max(160)).max(200),
      createCustomerKeywords: z.array(z.string().min(1).max(160)).max(200),
      createInvoiceKeywords: z.array(z.string().min(1).max(160)).max(200),
    }),
    payments: z.object({
      wiseKeywords: z.array(z.string().min(1).max(160)).max(200),
      wiseRecipientsKeywords: z.array(z.string().min(1).max(160)).max(200),
      wiseTransferKeywords: z.array(z.string().min(1).max(160)).max(200),
      stripeKeywords: z.array(z.string().min(1).max(160)).max(200),
      stripePaymentKeywords: z.array(z.string().min(1).max(160)).max(200),
    }),
    stackOps: z.object({
      baseKeywords: z.array(z.string().min(1).max(160)).max(200),
      deployKeywords: z.array(z.string().min(1).max(160)).max(200),
      rollbackKeywords: z.array(z.string().min(1).max(160)).max(200),
      dryRunKeywords: z.array(z.string().min(1).max(160)).max(200),
      smartDeployKeywords: z.array(z.string().min(1).max(160)).max(200),
      stackKeywords: z.array(z.string().min(1).max(160)).max(200),
    }),
  }),
  platformLinks: z.array(agenticLinkSchema).max(100),
});

type AgenticSettingsForm = z.infer<typeof agenticSettingsSchema>;
type AgenticTaskTypeKeyword = keyof AgenticSettingsForm['detectors']['agenticTask']['typeKeywords'];
type ErpKeywordField = keyof AgenticSettingsForm['detectors']['erp'];
type PaymentsKeywordField = keyof AgenticSettingsForm['detectors']['payments'];
type StackOpsKeywordField = keyof AgenticSettingsForm['detectors']['stackOps'];

type AgenticSettingsResponse = {
  settings: AgenticSettingsForm;
  defaults: AgenticSettingsForm;
};

export default function AgenticConfig() {
  const { t } = useTranslation();
  const agenticTaskTypeKeywordItems: Array<{ name: AgenticTaskTypeKeyword; label: string }> = [
    { name: 'document', label: t('agenticConfig.taskTypeDocument') },
    { name: 'report', label: t('agenticConfig.taskTypeReport') },
    { name: 'accounting', label: t('agenticConfig.taskTypeAccounting') },
    { name: 'planning', label: t('agenticConfig.taskTypePlanning') },
  ];
  const erpKeywordItems: Array<{ name: ErpKeywordField; label: string }> = [
    { name: 'listItemsKeywords', label: t('agenticConfig.erpItemsKeywords') },
    { name: 'listCustomersKeywords', label: t('agenticConfig.erpCustomersKeywords') },
    { name: 'listInvoicesKeywords', label: t('agenticConfig.erpInvoicesKeywords') },
    { name: 'annualBillingKeywords', label: t('agenticConfig.erpAnnualBillingKeywords') },
    { name: 'createCustomerKeywords', label: t('agenticConfig.erpCreateCustomerKeywords') },
    { name: 'createInvoiceKeywords', label: t('agenticConfig.erpCreateInvoiceKeywords') },
  ];
  const paymentsKeywordItems: Array<{ name: PaymentsKeywordField; label: string }> = [
    { name: 'wiseRecipientsKeywords', label: t('agenticConfig.wiseRecipientsKeywords') },
    { name: 'wiseTransferKeywords', label: t('agenticConfig.wiseTransferKeywords') },
    { name: 'stripeKeywords', label: t('agenticConfig.stripeKeywords') },
    { name: 'stripePaymentKeywords', label: t('agenticConfig.stripePaymentKeywords') },
  ];
  const stackOpsKeywordItems: Array<{ name: StackOpsKeywordField; label: string }> = [
    { name: 'deployKeywords', label: t('agenticConfig.stackDeployKeywords') },
    { name: 'rollbackKeywords', label: t('agenticConfig.stackRollbackKeywords') },
    { name: 'dryRunKeywords', label: t('agenticConfig.stackDryRunKeywords') },
    { name: 'smartDeployKeywords', label: t('agenticConfig.stackSmartDeployKeywords') },
    { name: 'stackKeywords', label: t('agenticConfig.stackKeywords') },
  ];
  const form = useForm<AgenticSettingsForm>({
    resolver: zodResolver(agenticSettingsSchema),
    defaultValues: {
      webEnabled: true,
      erpReadEnabled: true,
      erpWriteEnabled: true,
      tradingEnabled: true,
      paymentsEnabled: true,
      stackOpsEnabled: true,
      financialApprovalRequired: true,
      detectors: {
        webSearch: { keywords: [], patterns: [] },
        deepWeb: { keywords: [], patterns: [] },
        webImageSearch: { keywords: [], patterns: [] },
        imageGeneration: { keywords: [], patterns: [] },
        trading: { keywords: [], patterns: [] },
        agenticTask: {
          createKeywords: [],
          updateKeywords: [],
          intentKeywords: [],
          typeKeywords: {
            document: [],
            report: [],
            accounting: [],
            planning: [],
          },
        },
        erp: {
          baseKeywords: [],
          listItemsKeywords: [],
          listCustomersKeywords: [],
          listInvoicesKeywords: [],
          annualBillingKeywords: [],
          createCustomerKeywords: [],
          createInvoiceKeywords: [],
        },
        payments: {
          wiseKeywords: [],
          wiseRecipientsKeywords: [],
          wiseTransferKeywords: [],
          stripeKeywords: [],
          stripePaymentKeywords: [],
        },
        stackOps: {
          baseKeywords: [],
          deployKeywords: [],
          rollbackKeywords: [],
          dryRunKeywords: [],
          smartDeployKeywords: [],
          stackKeywords: [],
        },
      },
      platformLinks: [],
    },
  });

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: 'platformLinks',
  });

  const { data, isLoading } = useQuery<AgenticSettingsResponse>({
    queryKey: ['/api/agentic/settings'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/agentic/settings');
      return res.json();
    },
  });

  useEffect(() => {
    if (!data) return;
    form.reset(data.settings ?? data.defaults);
    replace(data.settings?.platformLinks ?? []);
  }, [data, form, replace]);

  const mutation = useMutation({
    mutationFn: async (values: AgenticSettingsForm) => {
      const res = await apiRequest('PATCH', '/api/agentic/settings', values);
      return res.json();
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

  const onSubmit = (values: AgenticSettingsForm) => {
    mutation.mutate(values);
  };

  const listToTextarea = (list?: string[] | null) => (list ?? []).join('\n');
  const textareaToList = (value: string) => value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('agenticConfig.title')}</h1>
        <p className="text-muted-foreground">{t('agenticConfig.subtitle')}</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('agenticConfig.togglesTitle')}</CardTitle>
              <CardDescription>{t('agenticConfig.togglesDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {[
                { name: 'webEnabled', label: t('agenticConfig.webEnabled') },
                { name: 'erpReadEnabled', label: t('agenticConfig.erpReadEnabled') },
                { name: 'erpWriteEnabled', label: t('agenticConfig.erpWriteEnabled') },
                { name: 'tradingEnabled', label: t('agenticConfig.tradingEnabled') },
                { name: 'paymentsEnabled', label: t('agenticConfig.paymentsEnabled') },
                { name: 'stackOpsEnabled', label: t('agenticConfig.stackOpsEnabled') },
                { name: 'financialApprovalRequired', label: t('agenticConfig.financialApprovalRequired') },
              ].map((field) => (
                <FormField
                  key={field.name}
                  control={form.control}
                  name={field.name as keyof AgenticSettingsForm}
                  render={({ field: formField }) => (
                    <FormItem className="flex items-center justify-between space-x-2">
                      <FormLabel className="text-sm">{field.label}</FormLabel>
                      <FormControl>
                        <Switch
                          checked={Boolean(formField.value)}
                          onCheckedChange={formField.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('agenticConfig.linksTitle')}</CardTitle>
              <CardDescription>{t('agenticConfig.linksDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {fields.map((field, index) => (
                <div key={field.id} className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{t('agenticConfig.linkItemTitle', { index: index + 1 })}</h3>
                    <Button type="button" variant="outline" size="sm" onClick={() => remove(index)}>
                      {t('agenticConfig.removeLink')}
                    </Button>
                  </div>
                  <Separator />
                  <FormField
                    control={form.control}
                    name={`platformLinks.${index}.name`}
                    render={({ field: formField }) => (
                      <FormItem>
                        <FormLabel>{t('agenticConfig.linkName')}</FormLabel>
                        <FormControl>
                          <Input {...formField} placeholder="ERPNext CRM" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`platformLinks.${index}.url`}
                    render={({ field: formField }) => (
                      <FormItem>
                        <FormLabel>{t('agenticConfig.linkUrl')}</FormLabel>
                        <FormControl>
                          <Input {...formField} placeholder="https://erp.seudominio.com" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`platformLinks.${index}.description`}
                    render={({ field: formField }) => (
                      <FormItem>
                        <FormLabel>{t('agenticConfig.linkDescription')}</FormLabel>
                        <FormControl>
                          <Input
                            {...formField}
                            value={formField.value ?? ''}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              formField.onChange(nextValue.length === 0 ? null : nextValue);
                            }}
                            placeholder={t('agenticConfig.linkDescriptionPlaceholder')}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`platformLinks.${index}.tags`}
                    render={({ field: formField }) => (
                      <FormItem>
                        <FormLabel>{t('agenticConfig.linkTags')}</FormLabel>
                        <FormControl>
                          <Input
                            value={(formField.value ?? []).join(', ')}
                            onChange={(event) => {
                              const value = event.target.value;
                              const tags = value
                                .split(',')
                                .map((tag) => tag.trim())
                                .filter(Boolean);
                              formField.onChange(tags);
                            }}
                            placeholder={t('agenticConfig.linkTagsPlaceholder')}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ))}

              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  append({
                    id: crypto.randomUUID(),
                    name: '',
                    url: '',
                    description: '',
                    tags: [],
                  })
                }
              >
                {t('agenticConfig.addLink')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('agenticConfig.detectorsTitle')}</CardTitle>
              <CardDescription>{t('agenticConfig.detectorsDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">{t('agenticConfig.detectorsWebTitle')}</h3>
                <FormField
                  control={form.control}
                  name="detectors.webSearch.keywords"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.webKeywords')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.webKeywordsPlaceholder')}
                          rows={4}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="detectors.webSearch.patterns"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.webPatterns')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.webPatternsPlaceholder')}
                          rows={4}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="detectors.deepWeb.keywords"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.deepWebKeywords')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.deepWebKeywordsPlaceholder')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="detectors.deepWeb.patterns"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.deepWebPatterns')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.deepWebPatternsPlaceholder')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="text-sm font-semibold">{t('agenticConfig.detectorsImagesTitle')}</h3>
                <FormField
                  control={form.control}
                  name="detectors.webImageSearch.keywords"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.webImageKeywords')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.webImageKeywordsPlaceholder')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="detectors.webImageSearch.patterns"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.webImagePatterns')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.webImagePatternsPlaceholder')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="detectors.imageGeneration.keywords"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.imageGenKeywords')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.imageGenKeywordsPlaceholder')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="detectors.imageGeneration.patterns"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.imageGenPatterns')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.imageGenPatternsPlaceholder')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="text-sm font-semibold">{t('agenticConfig.detectorsTasksTitle')}</h3>
                <FormField
                  control={form.control}
                  name="detectors.agenticTask.createKeywords"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.taskCreateKeywords')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.taskCreateKeywordsPlaceholder')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="detectors.agenticTask.updateKeywords"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.taskUpdateKeywords')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.taskUpdateKeywordsPlaceholder')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="detectors.agenticTask.intentKeywords"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.taskIntentKeywords')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.taskIntentKeywordsPlaceholder')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid gap-4 md:grid-cols-2">
                  {agenticTaskTypeKeywordItems.map((item) => {
                    const fieldName: `detectors.agenticTask.typeKeywords.${AgenticTaskTypeKeyword}` =
                      `detectors.agenticTask.typeKeywords.${item.name}`;
                    return (
                    <FormField
                      key={item.name}
                      control={form.control}
                      name={fieldName}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{item.label}</FormLabel>
                          <FormControl>
                            <Textarea
                              value={listToTextarea(field.value)}
                              onChange={(event) => field.onChange(textareaToList(event.target.value))}
                              placeholder={t('agenticConfig.taskTypePlaceholder')}
                              rows={3}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    );
                  })}
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="text-sm font-semibold">{t('agenticConfig.detectorsErpTitle')}</h3>
                <FormField
                  control={form.control}
                  name="detectors.erp.baseKeywords"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.erpBaseKeywords')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.erpBaseKeywordsPlaceholder')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid gap-4 md:grid-cols-2">
                  {erpKeywordItems.map((item) => {
                    const fieldName: `detectors.erp.${ErpKeywordField}` = `detectors.erp.${item.name}`;
                    return (
                    <FormField
                      key={item.name}
                      control={form.control}
                      name={fieldName}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{item.label}</FormLabel>
                          <FormControl>
                            <Textarea
                              value={listToTextarea(field.value)}
                              onChange={(event) => field.onChange(textareaToList(event.target.value))}
                              placeholder={t('agenticConfig.erpKeywordsPlaceholder')}
                              rows={3}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    );
                  })}
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="text-sm font-semibold">{t('agenticConfig.detectorsPaymentsTitle')}</h3>
                <FormField
                  control={form.control}
                  name="detectors.payments.wiseKeywords"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.wiseKeywords')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.wiseKeywordsPlaceholder')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid gap-4 md:grid-cols-2">
                  {paymentsKeywordItems.map((item) => {
                    const fieldName: `detectors.payments.${PaymentsKeywordField}` =
                      `detectors.payments.${item.name}`;
                    return (
                    <FormField
                      key={item.name}
                      control={form.control}
                      name={fieldName}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{item.label}</FormLabel>
                          <FormControl>
                            <Textarea
                              value={listToTextarea(field.value)}
                              onChange={(event) => field.onChange(textareaToList(event.target.value))}
                              placeholder={t('agenticConfig.paymentsKeywordsPlaceholder')}
                              rows={3}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    );
                  })}
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="text-sm font-semibold">{t('agenticConfig.detectorsStackTitle')}</h3>
                <FormField
                  control={form.control}
                  name="detectors.stackOps.baseKeywords"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.stackBaseKeywords')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.stackBaseKeywordsPlaceholder')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid gap-4 md:grid-cols-2">
                  {stackOpsKeywordItems.map((item) => {
                    const fieldName: `detectors.stackOps.${StackOpsKeywordField}` =
                      `detectors.stackOps.${item.name}`;
                    return (
                    <FormField
                      key={item.name}
                      control={form.control}
                      name={fieldName}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{item.label}</FormLabel>
                          <FormControl>
                            <Textarea
                              value={listToTextarea(field.value)}
                              onChange={(event) => field.onChange(textareaToList(event.target.value))}
                              placeholder={t('agenticConfig.stackKeywordsPlaceholder')}
                              rows={3}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    );
                  })}
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="text-sm font-semibold">{t('agenticConfig.detectorsTradingTitle')}</h3>
                <FormField
                  control={form.control}
                  name="detectors.trading.keywords"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.tradingKeywords')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.tradingKeywordsPlaceholder')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="detectors.trading.patterns"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agenticConfig.tradingPatterns')}</FormLabel>
                      <FormControl>
                        <Textarea
                          value={listToTextarea(field.value)}
                          onChange={(event) => field.onChange(textareaToList(event.target.value))}
                          placeholder={t('agenticConfig.tradingPatternsPlaceholder')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

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
