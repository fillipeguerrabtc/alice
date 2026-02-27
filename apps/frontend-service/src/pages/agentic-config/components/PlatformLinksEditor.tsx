import { useFieldArray, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import type { AgenticSettingsForm } from '../types';

type PlatformLinksEditorProps = {
  form: UseFormReturn<AgenticSettingsForm>;
};

export function PlatformLinksEditor({ form }: PlatformLinksEditorProps) {
  const { t } = useTranslation();
  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: 'platformLinks',
  });

  return (
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
                        const tags = event.target.value
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

        <div className="flex flex-wrap gap-2">
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
          <Button
            type="button"
            variant="outline"
            onClick={() => replace([])}
          >
            {t('agenticConfig.clearLinks')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
