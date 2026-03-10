import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
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
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { buildRoleSlug, customRoleFormSchema, type CustomRoleFormData } from '@/pages/users-admin/form-schemas';
import type { CustomRoleItem, Role } from '@/pages/users-admin/types';

type CustomRoleFormDialogProps = {
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CustomRoleFormData) => void;
  open: boolean;
  role?: CustomRoleItem | null;
  roleOptions: Array<{ label: string; value: Role }>;
};

export function CustomRoleFormDialog({
  isLoading,
  onOpenChange,
  onSubmit,
  open,
  role,
  roleOptions,
}: CustomRoleFormDialogProps) {
  const { t } = useTranslation();
  const form = useForm<CustomRoleFormData>({
    resolver: asResolver<CustomRoleFormData>(zodResolver(customRoleFormSchema)),
    defaultValues: {
      nome: role?.nome || '',
      slug: role?.slug ?? undefined,
      descricao: role?.descricao || '',
      baseRole: role?.baseRole || 'viewer',
      ativo: role?.ativo ?? true,
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      nome: role?.nome || '',
      slug: role?.slug ?? undefined,
      descricao: role?.descricao || '',
      baseRole: role?.baseRole || 'viewer',
      ativo: role?.ativo ?? true,
    });
  }, [form, open, role?.baseRole, role?.descricao, role?.id, role?.nome, role?.slug, role?.ativo]);

  const slugPreview = buildRoleSlug(form.watch('nome'), form.watch('slug'));

  const handleSubmit = (data: CustomRoleFormData) => {
    onSubmit(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {role ? t('usersAdmin.roles.editTitle') : t('usersAdmin.roles.newTitle')}
          </DialogTitle>
          <DialogDescription>
            {role ? t('usersAdmin.roles.editDescription') : t('usersAdmin.roles.newDescription')}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="nome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('usersAdmin.roles.fields.name')}</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-role-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('usersAdmin.roles.fields.slug')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('usersAdmin.roles.fields.slugPlaceholder')} data-testid="input-role-slug" />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    {t('usersAdmin.roles.fields.slugPreview', { slug: slugPreview || '-' })}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="descricao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('usersAdmin.roles.fields.description')}</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-role-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="baseRole"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('usersAdmin.roles.fields.baseRole')}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger data-testid="input-role-base">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roleOptions.map((roleOption) => (
                          <SelectItem key={roleOption.value} value={roleOption.value}>
                            {roleOption.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ativo"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>{t('usersAdmin.roles.fields.active')}</FormLabel>
                    <FormMessage />
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isLoading} data-testid="button-role-save">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {role ? t('common.save') : t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
