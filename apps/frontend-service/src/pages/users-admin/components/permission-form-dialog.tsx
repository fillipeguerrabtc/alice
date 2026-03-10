import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type ControllerRenderProps } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { asResolver } from '@/lib/form-helpers';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import {
  buildPermissionCode,
  parsePermissionCode,
  permissionFormSchema,
  type PermissionFormData,
} from '@/pages/users-admin/form-schemas';
import type { PermissionItem } from '@/pages/users-admin/types';

type PermissionFormDialogProps = {
  actionOptions: Array<{ label: string; value: string }>;
  isLoading: boolean;
  moduleOptions: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: PermissionFormData) => void;
  open: boolean;
  permission?: PermissionItem | null;
  resourceOptionsByModule: Map<string, Set<string>>;
};

export function PermissionFormDialog({
  actionOptions,
  isLoading,
  moduleOptions,
  onOpenChange,
  onSubmit,
  open,
  permission,
  resourceOptionsByModule,
}: PermissionFormDialogProps) {
  const { t } = useTranslation();
  const form = useForm<PermissionFormData>({
    resolver: asResolver<PermissionFormData>(zodResolver(permissionFormSchema)),
    defaultValues: {
      nome: permission?.nome || '',
      descricao: permission?.descricao || '',
      modulo: permission?.modulo || '',
      recurso: permission?.codigo ? parsePermissionCode(permission.codigo).recurso : '',
      acao: permission?.codigo ? parsePermissionCode(permission.codigo).acao : 'read',
    },
  });

  const selectedModule = form.watch('modulo');
  const resourceOptions = useMemo(() => {
    if (!selectedModule) return [];
    const options = resourceOptionsByModule.get(selectedModule);
    return options ? Array.from(options).sort() : [];
  }, [resourceOptionsByModule, selectedModule]);

  const [resourceMode, setResourceMode] = useState<'select' | 'custom'>('select');
  const [moduleMode, setModuleMode] = useState<'select' | 'custom'>('select');

  useEffect(() => {
    if (!open) {
      return;
    }
    form.reset({
      nome: permission?.nome || '',
      descricao: permission?.descricao || '',
      modulo: permission?.modulo || '',
      recurso: permission?.codigo ? parsePermissionCode(permission.codigo).recurso : '',
      acao: permission?.codigo ? parsePermissionCode(permission.codigo).acao : 'read',
    });
    setResourceMode('select');
    setModuleMode('select');
    const moduleValue = permission?.modulo || '';
    if (moduleValue && !moduleOptions.includes(moduleValue)) {
      setModuleMode('custom');
    }
  }, [form, moduleOptions, open, permission?.codigo, permission?.descricao, permission?.id, permission?.modulo, permission?.nome]);

  useEffect(() => {
    if (!selectedModule) return;
    if (moduleMode === 'select' && resourceOptions.length === 0) {
      setResourceMode('custom');
      return;
    }
    if (resourceMode === 'select' && resourceOptions.length > 0) {
      const current = form.getValues('recurso');
      if (!current) {
        form.setValue('recurso', resourceOptions[0]);
        return;
      }
      if (!resourceOptions.includes(current)) {
        setResourceMode('custom');
        return;
      }
    }
  }, [form, moduleMode, resourceMode, resourceOptions, selectedModule]);

  useEffect(() => {
    if (moduleMode === 'custom') {
      setResourceMode('custom');
    }
  }, [moduleMode]);

  const handleSubmit = (data: PermissionFormData) => {
    onSubmit(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {permission ? t('usersAdmin.permissions.editTitle') : t('usersAdmin.permissions.newTitle')}
          </DialogTitle>
          <DialogDescription>
            {permission ? t('usersAdmin.permissions.editDescription') : t('usersAdmin.permissions.newDescription')}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormItem>
              <FormLabel>{t('usersAdmin.permissions.fields.code')}</FormLabel>
              <FormControl>
                <Input
                  value={buildPermissionCode(
                    form.watch('modulo'),
                    form.watch('recurso'),
                    form.watch('acao')
                  )}
                  readOnly
                  data-testid="input-permission-code"
                />
              </FormControl>
            </FormItem>
            <FormField
              control={form.control}
              name="nome"
              render={({ field }: { field: ControllerRenderProps<PermissionFormData, 'nome'> }) => (
                <FormItem>
                  <FormLabel>{t('usersAdmin.permissions.fields.name')}</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-permission-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="descricao"
              render={({ field }: { field: ControllerRenderProps<PermissionFormData, 'descricao'> }) => (
                <FormItem>
                  <FormLabel>{t('usersAdmin.permissions.fields.description')}</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-permission-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="modulo"
              render={({ field }: { field: ControllerRenderProps<PermissionFormData, 'modulo'> }) => (
                <FormItem>
                  <FormLabel>{t('usersAdmin.permissions.fields.module')}</FormLabel>
                  <FormControl>
                    {moduleMode === 'select' ? (
                      <Select
                        value={field.value}
                        onValueChange={(value) => {
                          if (value === '__custom__') {
                            setModuleMode('custom');
                            field.onChange('');
                            return;
                          }
                          setModuleMode('select');
                          field.onChange(value);
                        }}
                        disabled={!!permission}
                      >
                        <SelectTrigger data-testid="input-permission-module">
                          <SelectValue placeholder={t('usersAdmin.permissions.fields.modulePlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          {moduleOptions.map((modulo) => (
                            <SelectItem key={modulo} value={modulo}>
                              {modulo}
                            </SelectItem>
                          ))}
                          <SelectItem value="__custom__">{t('usersAdmin.permissions.fields.customModule')}</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="space-y-2">
                        <Input
                          {...field}
                          disabled={!!permission}
                          placeholder={t('usersAdmin.permissions.fields.modulePlaceholder')}
                          data-testid="input-permission-module"
                        />
                        {!permission && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setModuleMode('select')}
                          >
                            {t('usersAdmin.permissions.fields.useExistingModule')}
                          </Button>
                        )}
                      </div>
                    )}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="recurso"
              render={({ field }: { field: ControllerRenderProps<PermissionFormData, 'recurso'> }) => (
                <FormItem>
                  <FormLabel>{t('usersAdmin.permissions.fields.resource')}</FormLabel>
                  <FormControl>
                    {resourceMode === 'select' ? (
                      <Select
                        value={field.value}
                        onValueChange={(value) => {
                          if (value === '__custom__') {
                            setResourceMode('custom');
                            field.onChange('');
                            return;
                          }
                          setResourceMode('select');
                          field.onChange(value);
                        }}
                        disabled={!!permission}
                      >
                        <SelectTrigger data-testid="input-permission-resource">
                          <SelectValue placeholder={t('usersAdmin.permissions.fields.resourcePlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          {resourceOptions.map((resource) => (
                            <SelectItem key={resource} value={resource}>
                              {resource}
                            </SelectItem>
                          ))}
                          <SelectItem value="__custom__">{t('usersAdmin.permissions.fields.customResource')}</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="space-y-2">
                        <Input
                          {...field}
                          data-testid="input-permission-resource"
                          disabled={!!permission}
                          placeholder={t('usersAdmin.permissions.fields.resourcePlaceholder')}
                        />
                        {!permission && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setResourceMode('select')}
                          >
                            {t('usersAdmin.permissions.fields.useExistingResource')}
                          </Button>
                        )}
                      </div>
                    )}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="acao"
              render={({ field }: { field: ControllerRenderProps<PermissionFormData, 'acao'> }) => (
                <FormItem>
                  <FormLabel>{t('usersAdmin.permissions.fields.action')}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!!permission}>
                      <SelectTrigger data-testid="input-permission-action">
                        <SelectValue placeholder={t('usersAdmin.permissions.fields.actionPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {actionOptions.map((action) => (
                          <SelectItem key={action.value} value={action.value}>
                            {action.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isLoading} data-testid="button-permission-save">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {permission ? t('common.save') : t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
