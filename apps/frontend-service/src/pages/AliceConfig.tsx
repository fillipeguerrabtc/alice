import { useEffect, useMemo, useState } from 'react';
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const assistantSettingsSchema = z.object({
  systemPrompt: z.string().min(10, 'System Prompt deve ter pelo menos 10 caracteres').max(20000).optional().nullable(),
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
    behavior?: string | null;
    mood?: string | null;
    behaviorDirectness?: number | null;
    behaviorProactivity?: number | null;
    moodFormality?: number | null;
    moodEmpathy?: number | null;
  } | null;
  defaults: {
    systemPrompt: string;
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
  };
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
      behavior: '',
      mood: '',
      behaviorDirectness: 50,
      behaviorProactivity: 50,
      moodFormality: 50,
      moodEmpathy: 70,
    },
  });

  const { data, isLoading } = useQuery<AssistantSettingsResponse>({
    queryKey: ['/api/assistant-settings'],
    staleTime: 1000 * 60,
  });

  useEffect(() => {
    if (data) {
      form.reset({
        systemPrompt: data.settings?.systemPrompt ?? data.defaults.systemPrompt ?? '',
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
      behavior: data.defaults.behavior ?? '',
      mood: data.defaults.mood ?? '',
      behaviorDirectness: data.defaults.behaviorDirectness ?? 50,
      behaviorProactivity: data.defaults.behaviorProactivity ?? 50,
      moodFormality: data.defaults.moodFormality ?? 50,
      moodEmpathy: data.defaults.moodEmpathy ?? 70,
    });
  };

  const { data: agentsData, isLoading: agentsLoading } = useQuery<AgentPrompt[]>({
    queryKey: ['/api/agents'],
    staleTime: 1000 * 60,
  });

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
          <CardTitle>{t('aliceConfig.creatorTitle')}</CardTitle>
          <CardDescription>{t('aliceConfig.creatorDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Badge variant="secondary">{data?.enforced.creator || 'Fillipe Guerra'}</Badge>
          {data?.enforced.creatorRule && (
            <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">
              {data.enforced.creatorRule}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('aliceConfig.settingsTitle')}</CardTitle>
          <CardDescription>{t('aliceConfig.settingsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((values) => updateSettings.mutate(values))}
                className="space-y-6"
              >
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
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={updateSettings.isPending}>
                    {t('aliceConfig.save')}
                  </Button>
                  <Button type="button" variant="outline" onClick={handleReset}>
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
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <FormLabel>{t('aliceConfig.agentsSelect')}</FormLabel>
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

              <FormItem>
                <FormLabel>{t('aliceConfig.agentInstructions')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={4}
                    value={agentInstructions}
                    onChange={(event) => setAgentInstructions(event.target.value)}
                  />
                </FormControl>
              </FormItem>

              <FormItem>
                <FormLabel>{t('aliceConfig.agentPersonality')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    value={agentPersonality}
                    onChange={(event) => setAgentPersonality(event.target.value)}
                  />
                </FormControl>
              </FormItem>

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
