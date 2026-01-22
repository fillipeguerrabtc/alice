import { useEffect, useMemo, useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const optionalTextWithMin = (min: number, max: number, message: string) =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      return value.trim();
    },
    z.union([z.literal(''), z.string().min(min, message).max(max)]).optional().nullable()
  );

const assistantSettingsSchema = z.object({
  systemPrompt: optionalTextWithMin(10, 20000, 'System Prompt deve ter pelo menos 10 caracteres'),
  creatorName: optionalTextWithMin(2, 200, 'Nome do criador deve ter pelo menos 2 caracteres'),
  creatorRule: optionalTextWithMin(10, 5000, 'Regra do criador deve ter pelo menos 10 caracteres'),
  ethicsPolicy: optionalTextWithMin(10, 5000, 'Política de ética deve ter pelo menos 10 caracteres'),
  moralPolicy: optionalTextWithMin(10, 5000, 'Política moral deve ter pelo menos 10 caracteres'),
  legalPolicy: optionalTextWithMin(10, 5000, 'Política legal deve ter pelo menos 10 caracteres'),
  safetyGuardrails: optionalTextWithMin(10, 8000, 'Guardrails devem ter pelo menos 10 caracteres'),
  nsfwPolicy: optionalTextWithMin(10, 5000, 'Política NSFW deve ter pelo menos 10 caracteres'),
  behavior: z.string().max(5000).optional().nullable(),
  mood: z.string().max(2000).optional().nullable(),
  behaviorDirectness: z.number().min(0).max(100).optional().nullable(),
  behaviorProactivity: z.number().min(0).max(100).optional().nullable(),
  moodFormality: z.number().min(0).max(100).optional().nullable(),
  moodEmpathy: z.number().min(0).max(100).optional().nullable(),
});

type AssistantSettingsForm = z.infer<typeof assistantSettingsSchema>;

type AssistantSettingsResponse = {
  settings: {
    systemPrompt?: string | null;
    creatorName?: string | null;
    creatorRule?: string | null;
    ethicsPolicy?: string | null;
    moralPolicy?: string | null;
    legalPolicy?: string | null;
    safetyGuardrails?: string | null;
    nsfwPolicy?: string | null;
    behavior?: string | null;
    mood?: string | null;
    behaviorDirectness?: number | null;
    behaviorProactivity?: number | null;
    moodFormality?: number | null;
    moodEmpathy?: number | null;
  } | null;
  defaults: {
    systemPrompt: string;
    creatorName: string;
    creatorRule: string;
    ethicsPolicy: string;
    moralPolicy: string;
    legalPolicy: string;
    safetyGuardrails: string;
    nsfwPolicy: string;
    behavior: string | null;
    mood: string | null;
    behaviorDirectness: number;
    behaviorProactivity: number;
    moodFormality: number;
    moodEmpathy: number;
  };
  enforced: {
    creator: string;
    creatorRule?: string;
    ethicsPolicy?: string;
    moralPolicy?: string;
    legalPolicy?: string;
    safetyGuardrails?: string;
    nsfwPolicy?: string;
  };
  missingCoreFields?: string[];
};

type AgentPrompt = {
  id: string;
  nome: string;
  instrucoes: string | null;
  personalidade: string | null;
};

export default function AliceConfig() {
  const { t } = useTranslation();

  const form = useForm<AssistantSettingsForm>({
    resolver: zodResolver(assistantSettingsSchema),
    defaultValues: {
      systemPrompt: '',
      creatorName: '',
      creatorRule: '',
      ethicsPolicy: '',
      moralPolicy: '',
      legalPolicy: '',
      safetyGuardrails: '',
      nsfwPolicy: '',
      behavior: '',
      mood: '',
      behaviorDirectness: 50,
      behaviorProactivity: 50,
      moodFormality: 50,
      moodEmpathy: 70,
    },
  });

  const { data, isLoading, error: settingsError } = useQuery<AssistantSettingsResponse>({
    queryKey: ['/api/assistant-settings'],
    staleTime: 1000 * 60,
  });
  const { data: permissionsData } = useQuery<{ permissions: string[] }>({
    queryKey: ['/api/auth/rbac/permissions'],
    staleTime: 1000 * 60,
  });
  const settingsErrorRef = useRef<string | null>(null);
  const canEditCore = Boolean(permissionsData?.permissions?.includes('admin:alice_core:write'));

  useEffect(() => {
    if (data) {
      form.reset({
        systemPrompt: data.settings?.systemPrompt ?? data.defaults.systemPrompt ?? '',
        creatorName: data.settings?.creatorName ?? data.defaults.creatorName ?? '',
        creatorRule: data.settings?.creatorRule ?? data.defaults.creatorRule ?? '',
        ethicsPolicy: data.settings?.ethicsPolicy ?? data.defaults.ethicsPolicy ?? '',
        moralPolicy: data.settings?.moralPolicy ?? data.defaults.moralPolicy ?? '',
        legalPolicy: data.settings?.legalPolicy ?? data.defaults.legalPolicy ?? '',
        safetyGuardrails: data.settings?.safetyGuardrails ?? data.defaults.safetyGuardrails ?? '',
        nsfwPolicy: data.settings?.nsfwPolicy ?? data.defaults.nsfwPolicy ?? '',
        behavior: data.settings?.behavior ?? data.defaults.behavior ?? '',
        mood: data.settings?.mood ?? data.defaults.mood ?? '',
        behaviorDirectness: data.settings?.behaviorDirectness ?? data.defaults.behaviorDirectness ?? 50,
        behaviorProactivity: data.settings?.behaviorProactivity ?? data.defaults.behaviorProactivity ?? 50,
        moodFormality: data.settings?.moodFormality ?? data.defaults.moodFormality ?? 50,
        moodEmpathy: data.settings?.moodEmpathy ?? data.defaults.moodEmpathy ?? 70,
      });
    }
  }, [data, form]);

  const updateSettings = useMutation({
    mutationFn: async (values: AssistantSettingsForm) => {
      const res = await apiRequest('PATCH', '/api/assistant-settings', values);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/assistant-settings'] });
      toast({
        title: t('aliceConfig.saveSuccessTitle'),
        description: t('aliceConfig.saveSuccessDesc'),
      });
    },
    onError: (error) => {
      toast({
        title: t('aliceConfig.saveErrorTitle'),
        description: error instanceof Error ? error.message : t('aliceConfig.saveErrorDesc'),
        variant: 'destructive',
      });
    },
  });

  const handleReset = () => {
    if (!data) return;
    form.reset({
      systemPrompt: data.defaults.systemPrompt ?? '',
      creatorName: data.defaults.creatorName ?? '',
      creatorRule: data.defaults.creatorRule ?? '',
      ethicsPolicy: data.defaults.ethicsPolicy ?? '',
      moralPolicy: data.defaults.moralPolicy ?? '',
      legalPolicy: data.defaults.legalPolicy ?? '',
      safetyGuardrails: data.defaults.safetyGuardrails ?? '',
      nsfwPolicy: data.defaults.nsfwPolicy ?? '',
      behavior: data.defaults.behavior ?? '',
      mood: data.defaults.mood ?? '',
      behaviorDirectness: data.defaults.behaviorDirectness ?? 50,
      behaviorProactivity: data.defaults.behaviorProactivity ?? 50,
      moodFormality: data.defaults.moodFormality ?? 50,
      moodEmpathy: data.defaults.moodEmpathy ?? 70,
    });
  };

  const { data: agentsData, isLoading: agentsLoading, error: agentsError } = useQuery<AgentPrompt[]>({
    queryKey: ['/api/agents'],
    staleTime: 1000 * 60,
  });
  const agentsErrorRef = useRef<string | null>(null);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentInstructions, setAgentInstructions] = useState('');
  const [agentPersonality, setAgentPersonality] = useState('');

  const selectedAgent = useMemo(
    () => agentsData?.find((agent) => agent.id === selectedAgentId) ?? null,
    [agentsData, selectedAgentId]
  );

  useEffect(() => {
    if (!selectedAgentId && agentsData && agentsData.length > 0) {
      setSelectedAgentId(agentsData[0].id);
    }
  }, [agentsData, selectedAgentId]);

  useEffect(() => {
    if (selectedAgent) {
      setAgentInstructions(selectedAgent.instrucoes ?? '');
      setAgentPersonality(selectedAgent.personalidade ?? '');
    }
  }, [selectedAgent]);

  useEffect(() => {
    if (!settingsError) {
      settingsErrorRef.current = null;
      return;
    }
    const message = settingsError instanceof Error ? settingsError.message : t('aliceConfig.loadErrorDesc');
    if (settingsErrorRef.current === message) return;
    settingsErrorRef.current = message;
    toast({
      title: t('aliceConfig.loadErrorTitle'),
      description: message,
      variant: 'destructive',
    });
  }, [settingsError, t, toast]);

  useEffect(() => {
    if (!agentsError) {
      agentsErrorRef.current = null;
      return;
    }
    const message = agentsError instanceof Error ? agentsError.message : t('aliceConfig.agentsLoadErrorDesc');
    if (agentsErrorRef.current === message) return;
    agentsErrorRef.current = message;
    toast({
      title: t('aliceConfig.agentsLoadErrorTitle'),
      description: message,
      variant: 'destructive',
    });
  }, [agentsError, t, toast]);

  const updateAgentPrompt = useMutation({
    mutationFn: async () => {
      if (!selectedAgentId) {
        throw new Error('Agente não selecionado');
      }
      const res = await apiRequest('PATCH', `/api/agents/${selectedAgentId}`, {
        instrucoes: agentInstructions || null,
        personalidade: agentPersonality || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/agents'] });
      toast({
        title: t('aliceConfig.agentSaveSuccessTitle'),
        description: t('aliceConfig.agentSaveSuccessDesc'),
      });
    },
    onError: (error) => {
      toast({
        title: t('aliceConfig.agentSaveErrorTitle'),
        description: error instanceof Error ? error.message : t('aliceConfig.agentSaveErrorDesc'),
        variant: 'destructive',
      });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{t('aliceConfig.title')}</h1>
        <p className="text-muted-foreground">{t('aliceConfig.description')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('aliceConfig.settingsTitle')}</CardTitle>
          <CardDescription>{t('aliceConfig.settingsDescription')}</CardDescription>
          {!canEditCore && (
            <Badge variant="secondary">{t('aliceConfig.readOnlyBadge')}</Badge>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : settingsError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {t('aliceConfig.loadErrorDesc')}
            </div>
          ) : (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((values) => updateSettings.mutate(values))}
                className="space-y-6"
              >
                <Tabs defaultValue="core" className="space-y-6">
                  <TabsList>
                    <TabsTrigger value="core">{t('aliceConfig.tabs.core')}</TabsTrigger>
                    <TabsTrigger value="behavior">{t('aliceConfig.tabs.behavior')}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="core" className="space-y-6">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{t('aliceConfig.coreBadge')}</Badge>
                        {!canEditCore && (
                          <span className="text-xs text-muted-foreground">
                            {t('aliceConfig.coreReadOnlyHint')}
                          </span>
                        )}
                      </div>
                      <FormField
                        control={form.control}
                        name="creatorName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aliceConfig.creatorName')}</FormLabel>
                            <FormControl>
                              <Input
                                placeholder={t('aliceConfig.creatorNamePlaceholder')}
                                {...field}
                                value={field.value ?? ''}
                                disabled={!canEditCore}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="creatorRule"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aliceConfig.creatorRule')}</FormLabel>
                            <FormControl>
                              <Textarea
                                rows={4}
                                placeholder={t('aliceConfig.creatorRulePlaceholder')}
                                {...field}
                                value={field.value ?? ''}
                                disabled={!canEditCore}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="space-y-4">
                      <FormField
                        control={form.control}
                        name="ethicsPolicy"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aliceConfig.ethicsPolicy')}</FormLabel>
                            <FormControl>
                              <Textarea
                                rows={4}
                                placeholder={t('aliceConfig.ethicsPolicyPlaceholder')}
                                {...field}
                                value={field.value ?? ''}
                                disabled={!canEditCore}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="moralPolicy"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aliceConfig.moralPolicy')}</FormLabel>
                            <FormControl>
                              <Textarea
                                rows={4}
                                placeholder={t('aliceConfig.moralPolicyPlaceholder')}
                                {...field}
                                value={field.value ?? ''}
                                disabled={!canEditCore}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="legalPolicy"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aliceConfig.legalPolicy')}</FormLabel>
                            <FormControl>
                              <Textarea
                                rows={4}
                                placeholder={t('aliceConfig.legalPolicyPlaceholder')}
                                {...field}
                                value={field.value ?? ''}
                                disabled={!canEditCore}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="safetyGuardrails"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aliceConfig.safetyGuardrails')}</FormLabel>
                            <FormControl>
                              <Textarea
                                rows={5}
                                placeholder={t('aliceConfig.safetyGuardrailsPlaceholder')}
                                {...field}
                                value={field.value ?? ''}
                                disabled={!canEditCore}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="nsfwPolicy"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aliceConfig.nsfwPolicy')}</FormLabel>
                            <FormControl>
                              <Textarea
                                rows={4}
                                placeholder={t('aliceConfig.nsfwPolicyPlaceholder')}
                                {...field}
                                value={field.value ?? ''}
                                disabled={!canEditCore}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="systemPrompt"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('aliceConfig.systemPrompt')}</FormLabel>
                          <FormControl>
                            <Textarea
                              rows={8}
                              placeholder={t('aliceConfig.systemPromptPlaceholder')}
                              {...field}
                              value={field.value ?? ''}
                              disabled={!canEditCore}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TabsContent>
                  <TabsContent value="behavior" className="space-y-6">
                    <FormField
                      control={form.control}
                      name="behavior"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('aliceConfig.behavior')}</FormLabel>
                          <FormControl>
                            <Textarea
                              rows={4}
                              placeholder={t('aliceConfig.behaviorPlaceholder')}
                              {...field}
                              value={field.value ?? ''}
                              disabled={!canEditCore}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="behaviorDirectness"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aliceConfig.sliders.directness')}</FormLabel>
                            <FormControl>
                              <Slider
                                value={[field.value ?? 50]}
                                onValueChange={(value) => field.onChange(value[0])}
                                min={0}
                                max={100}
                                step={5}
                                disabled={!canEditCore}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="behaviorProactivity"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aliceConfig.sliders.proactivity')}</FormLabel>
                            <FormControl>
                              <Slider
                                value={[field.value ?? 50]}
                                onValueChange={(value) => field.onChange(value[0])}
                                min={0}
                                max={100}
                                step={5}
                                disabled={!canEditCore}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="mood"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('aliceConfig.mood')}</FormLabel>
                          <FormControl>
                            <Textarea
                              rows={3}
                              placeholder={t('aliceConfig.moodPlaceholder')}
                              {...field}
                              value={field.value ?? ''}
                              disabled={!canEditCore}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="moodFormality"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aliceConfig.sliders.formality')}</FormLabel>
                            <FormControl>
                              <Slider
                                value={[field.value ?? 50]}
                                onValueChange={(value) => field.onChange(value[0])}
                                min={0}
                                max={100}
                                step={5}
                                disabled={!canEditCore}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="moodEmpathy"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('aliceConfig.sliders.empathy')}</FormLabel>
                            <FormControl>
                              <Slider
                                value={[field.value ?? 70]}
                                onValueChange={(value) => field.onChange(value[0])}
                                min={0}
                                max={100}
                                step={5}
                                disabled={!canEditCore}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </TabsContent>
                </Tabs>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={!canEditCore || updateSettings.isPending}>
                    {t('aliceConfig.save')}
                  </Button>
                  <Button type="button" variant="outline" onClick={handleReset} disabled={!canEditCore}>
                    {t('aliceConfig.reset')}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('aliceConfig.corePreviewTitle')}</CardTitle>
          <CardDescription>{t('aliceConfig.corePreviewDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>{t('aliceConfig.corePreview.creator')}</Label>
              <p className="text-sm text-muted-foreground">
                {data?.settings?.creatorName || '-'}
              </p>
            </div>
            <div>
              <Label>{t('aliceConfig.corePreview.systemPrompt')}</Label>
              <p className="text-sm text-muted-foreground">
                {data?.settings?.systemPrompt ? t('aliceConfig.corePreview.configured') : t('aliceConfig.corePreview.empty')}
              </p>
            </div>
          </div>
          <div>
            <Label>{t('aliceConfig.corePreview.guardrails')}</Label>
            <p className="text-sm text-muted-foreground">
              {data?.settings?.safetyGuardrails ? t('aliceConfig.corePreview.configured') : t('aliceConfig.corePreview.empty')}
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            {data?.missingCoreFields?.length
              ? t('aliceConfig.corePreview.missing', { count: data.missingCoreFields.length })
              : t('aliceConfig.corePreview.ready')}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('aliceConfig.defaultPromptTitle')}</CardTitle>
          <CardDescription>{t('aliceConfig.defaultPromptDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={data?.defaults.systemPrompt || ''}
            readOnly
            rows={8}
            className="bg-muted"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('aliceConfig.agentsTitle')}</CardTitle>
          <CardDescription>{t('aliceConfig.agentsDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {agentsLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : agentsError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {t('aliceConfig.agentsLoadErrorDesc')}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label>{t('aliceConfig.agentsSelect')}</Label>
                <Select value={selectedAgentId ?? ''} onValueChange={setSelectedAgentId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('aliceConfig.agentsSelectPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {agentsData?.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t('aliceConfig.agentInstructions')}</Label>
                <Textarea
                  rows={4}
                  value={agentInstructions}
                  onChange={(event) => setAgentInstructions(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('aliceConfig.agentPersonality')}</Label>
                <Textarea
                  rows={3}
                  value={agentPersonality}
                  onChange={(event) => setAgentPersonality(event.target.value)}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => updateAgentPrompt.mutate()}
                  disabled={updateAgentPrompt.isPending || !selectedAgentId}
                >
                  {t('aliceConfig.agentSave')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
