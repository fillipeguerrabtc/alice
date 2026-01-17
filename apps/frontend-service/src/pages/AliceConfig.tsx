import { useEffect } from 'react';
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

const assistantSettingsSchema = z.object({
  systemPrompt: z.string().min(10, 'System Prompt deve ter pelo menos 10 caracteres').max(20000).optional().nullable(),
  behavior: z.string().max(5000).optional().nullable(),
  mood: z.string().max(2000).optional().nullable(),
});

type AssistantSettingsForm = z.infer<typeof assistantSettingsSchema>;

type AssistantSettingsResponse = {
  settings: {
    systemPrompt?: string | null;
    behavior?: string | null;
    mood?: string | null;
  } | null;
  defaults: {
    systemPrompt: string;
    behavior: string | null;
    mood: string | null;
  };
  enforced: {
    creator: string;
  };
};

export default function AliceConfig() {
  const { t } = useTranslation();

  const form = useForm<AssistantSettingsForm>({
    resolver: zodResolver(assistantSettingsSchema),
    defaultValues: {
      systemPrompt: '',
      behavior: '',
      mood: '',
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
    });
  };

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
    </div>
  );
}
