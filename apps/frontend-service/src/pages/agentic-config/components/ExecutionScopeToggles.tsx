import type { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import type { AgenticSettingsForm } from '../types';

type ExecutionScopeTogglesProps = {
  form: UseFormReturn<AgenticSettingsForm>;
};

export function ExecutionScopeToggles({ form }: ExecutionScopeTogglesProps) {
  const { t } = useTranslation();
  const fields: Array<{ name: keyof AgenticSettingsForm; label: string }> = [
    { name: 'webEnabled', label: t('agenticConfig.webEnabled') },
    { name: 'erpReadEnabled', label: t('agenticConfig.erpReadEnabled') },
    { name: 'erpWriteEnabled', label: t('agenticConfig.erpWriteEnabled') },
    { name: 'observabilityReadEnabled', label: t('agenticConfig.observabilityReadEnabled') },
    { name: 'observabilityWriteEnabled', label: t('agenticConfig.observabilityWriteEnabled') },
    { name: 'tradingEnabled', label: t('agenticConfig.tradingEnabled') },
    { name: 'paymentsEnabled', label: t('agenticConfig.paymentsEnabled') },
    { name: 'stackOpsEnabled', label: t('agenticConfig.stackOpsEnabled') },
    { name: 'financialApprovalRequired', label: t('agenticConfig.financialApprovalRequired') },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('agenticConfig.togglesTitle')}</CardTitle>
        <CardDescription>{t('agenticConfig.togglesDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {fields.map((field) => (
          <FormField
            key={field.name}
            control={form.control}
            name={field.name}
            render={({ field: formField }) => (
              <FormItem className="flex items-center justify-between space-x-2">
                <FormLabel className="text-sm">{field.label}</FormLabel>
                <FormControl>
                  <Switch checked={Boolean(formField.value)} onCheckedChange={formField.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
        ))}
      </CardContent>
    </Card>
  );
}
