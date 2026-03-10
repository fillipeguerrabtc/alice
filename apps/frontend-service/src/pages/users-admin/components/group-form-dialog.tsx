import { useEffect } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { groupFormSchema, type GroupFormData } from '@/pages/users-admin/form-schemas';
import type { GroupItem } from '@/pages/users-admin/types';

type GroupFormDialogProps = {
  group?: GroupItem | null;
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: GroupFormData) => void;
  open: boolean;
};

export function GroupFormDialog({
  group,
  isLoading,
  onOpenChange,
  onSubmit,
  open,
}: GroupFormDialogProps) {
  const { t } = useTranslation();
  const form = useForm<GroupFormData>({
    resolver: asResolver<GroupFormData>(zodResolver(groupFormSchema)),
    defaultValues: {
      nome: group?.nome || '',
      descricao: group?.descricao || '',
      ativo: group?.ativo ?? true,
    },
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    form.reset({
      nome: group?.nome || '',
      descricao: group?.descricao || '',
      ativo: group?.ativo ?? true,
    });
  }, [form, group?.ativo, group?.descricao, group?.id, group?.nome, open]);

  const handleSubmit = (data: GroupFormData) => {
    onSubmit(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {group ? t('usersAdmin.groups.editTitle') : t('usersAdmin.groups.newTitle')}
          </DialogTitle>
          <DialogDescription>
            {group ? t('usersAdmin.groups.editDescription') : t('usersAdmin.groups.newDescription')}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="nome"
              render={({ field }: { field: ControllerRenderProps<GroupFormData, 'nome'> }) => (
                <FormItem>
                  <FormLabel>{t('usersAdmin.groups.fields.name')}</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-group-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="descricao"
              render={({ field }: { field: ControllerRenderProps<GroupFormData, 'descricao'> }) => (
                <FormItem>
                  <FormLabel>{t('usersAdmin.groups.fields.description')}</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-group-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ativo"
              render={({ field }: { field: ControllerRenderProps<GroupFormData, 'ativo'> }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>{t('usersAdmin.groups.fields.active')}</FormLabel>
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
              <Button type="submit" disabled={isLoading} data-testid="button-group-save">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {group ? t('common.save') : t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
