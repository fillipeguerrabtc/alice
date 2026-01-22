/**
 * Página de Gestão de Usuários/Grupos/Permissões - Alice Enterprise Platform
 *
 * Regra 6: Dados reais via API PostgreSQL (sem mocks)
 * Regra 10: Documentação PT-BR
 * Regra 13: Internacionalização i18next
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, ControllerRenderProps } from 'react-hook-form';
import { asResolver } from '@/lib/form-helpers';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Users, Shield, Layers, UserPlus, Pencil, Trash2, ShieldCheck } from 'lucide-react';

type Role = 'super_admin' | 'admin' | 'manager' | 'operator' | 'viewer' | 'guest';

type CustomRoleItem = {
  id: string;
  nome: string;
  slug: string;
  descricao?: string | null;
  baseRole: Role;
  ativo?: boolean | null;
};

type UserItem = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role?: Role | null;
  customRoleId?: string | null;
  customRole?: CustomRoleItem | null;
  cargo?: string | null;
  departamento?: string | null;
  ativo?: boolean | null;
  ultimoAcesso?: string | null;
  createdAt?: string | null;
  profileImageUrl?: string | null;
  authProvider?: string | null;
};

type GroupItem = {
  id: string;
  nome: string;
  descricao?: string | null;
  ativo?: boolean | null;
};

type PermissionItem = {
  id: string;
  codigo: string;
  nome: string;
  descricao?: string | null;
  modulo: string;
};

type RolePermissionItem = {
  id: string;
  role: Role;
  permissionId: string;
  permission: PermissionItem;
};

const roleOptions: Array<{ value: Role; label: string }> = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Administrador' },
  { value: 'manager', label: 'Gerente' },
  { value: 'operator', label: 'Operador' },
  { value: 'viewer', label: 'Visualizador' },
  { value: 'guest', label: 'Convidado' },
];

function parsePermissionCode(code: string): { modulo: string; recurso: string; acao: string } {
  const [modulo = '', recurso = '', acao = 'read'] = code.split(':');
  return { modulo, recurso, acao };
}

function normalizePermissionToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function buildPermissionCode(modulo: string, recurso: string, acao: string): string {
  const normalizedModulo = normalizePermissionToken(modulo);
  const normalizedRecurso = normalizePermissionToken(recurso);
  const normalizedAcao = normalizePermissionToken(acao);
  return `${normalizedModulo}:${normalizedRecurso}:${normalizedAcao}`;
}

function buildRoleSlug(name: string, slug?: string): string {
  const source = slug?.trim() ? slug : name;
  return normalizePermissionToken(source);
}

const groupFormSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(255),
  descricao: z.string().optional(),
  ativo: z.boolean().optional(),
});

type GroupFormData = z.infer<typeof groupFormSchema>;

const customRoleFormSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(255),
  slug: z.string().min(2, 'Slug deve ter pelo menos 2 caracteres').max(100).optional(),
  descricao: z.string().optional(),
  baseRole: z.enum(['super_admin', 'admin', 'manager', 'operator', 'viewer', 'guest']),
  ativo: z.boolean().optional(),
});

type CustomRoleFormData = z.infer<typeof customRoleFormSchema>;

const permissionFormSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(255),
  descricao: z.string().optional(),
  modulo: z.string().min(2, 'Módulo é obrigatório').max(100),
  recurso: z.string().min(2, 'Recurso é obrigatório').max(100),
  acao: z.string().min(2, 'Ação é obrigatória').max(50),
});

type PermissionFormData = z.infer<typeof permissionFormSchema>;

function buildPermissionPayload(values: PermissionFormData) {
  const normalizedModulo = normalizePermissionToken(values.modulo);
  return {
    codigo: buildPermissionCode(values.modulo, values.recurso, values.acao),
    nome: values.nome,
    descricao: values.descricao,
    modulo: normalizedModulo,
  };
}

function buildCustomRolePayload(values: CustomRoleFormData) {
  return {
    nome: values.nome,
    slug: buildRoleSlug(values.nome, values.slug),
    descricao: values.descricao,
    baseRole: values.baseRole,
    ativo: values.ativo ?? true,
  };
}

function formatUserName(user: UserItem) {
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return name || user.email || 'Usuário';
}

function GroupFormDialog({
  open,
  onOpenChange,
  group,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: GroupItem | null;
  onSubmit: (data: GroupFormData) => void;
  isLoading: boolean;
}) {
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

function CustomRoleFormDialog({
  open,
  onOpenChange,
  role,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: CustomRoleItem | null;
  onSubmit: (data: CustomRoleFormData) => void;
  isLoading: boolean;
}) {
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

function PermissionFormDialog({
  open,
  onOpenChange,
  permission,
  moduleOptions,
  resourceOptionsByModule,
  actionOptions,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  permission?: PermissionItem | null;
  moduleOptions: string[];
  resourceOptionsByModule: Map<string, Set<string>>;
  actionOptions: Array<{ value: string; label: string }>;
  onSubmit: (data: PermissionFormData) => void;
  isLoading: boolean;
}) {
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

function GroupMembersDialog({
  open,
  onOpenChange,
  group,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: GroupItem | null;
  users: UserItem[];
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  const { data: membersData, isLoading } = useQuery<{ members: Array<{ id: string; userId: string }> }>({
    queryKey: ['/api/auth/groups', group?.id, 'users'],
    enabled: open && !!group?.id,
    queryFn: async () => {
      if (!group?.id) {
        return { members: [] };
      }
      const response = await apiRequest('GET', `/api/auth/groups/${group.id}/users`);
      return response.json();
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!group?.id) throw new Error('Grupo inválido');
      const response = await apiRequest('POST', `/api/auth/groups/${group.id}/users`, { userId });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/groups', group?.id, 'users'] });
      setSelectedUserId('');
      toast({ title: t('usersAdmin.groups.membersAdded') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.groups.membersAddError'), description: error.message, variant: 'destructive' });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!group?.id) throw new Error('Grupo inválido');
      const response = await apiRequest('DELETE', `/api/auth/groups/${group.id}/users/${userId}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/groups', group?.id, 'users'] });
      toast({ title: t('usersAdmin.groups.membersRemoved') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.groups.membersRemoveError'), description: error.message, variant: 'destructive' });
    },
  });

  const memberIds = new Set(membersData?.members?.map((member) => member.userId) ?? []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t('usersAdmin.groups.manageMembersTitle')}</DialogTitle>
          <DialogDescription>{group?.nome}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('usersAdmin.groups.addMember')}</Label>
            <div className="flex gap-2">
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('usersAdmin.groups.selectUser')} />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id} disabled={memberIds.has(user.id)}>
                      {formatUserName(user)} ({user.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={!selectedUserId || addMemberMutation.isPending}
                onClick={() => addMemberMutation.mutate(selectedUserId)}
              >
                {addMemberMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('common.add')}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('usersAdmin.groups.currentMembers')}</Label>
            <ScrollArea className="h-[220px]">
              <div className="space-y-2">
                {isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('common.loading')}
                  </div>
                ) : membersData?.members?.length ? (
                  membersData.members.map((member) => {
                    const user = users.find((item) => item.id === member.userId);
                    return (
                      <div key={member.id} className="flex items-center justify-between rounded-md border p-2">
                        <div>
                          <p className="text-sm font-medium">{formatUserName(user || { id: member.userId })}</p>
                          <p className="text-xs text-muted-foreground">{user?.email}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeMemberMutation.mutate(member.userId)}
                        >
                          {t('common.remove')}
                        </Button>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">{t('usersAdmin.groups.noMembers')}</p>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersAdmin() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [selectedRole, setSelectedRole] = useState<Role>('admin');
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [customRoleDialogOpen, setCustomRoleDialogOpen] = useState(false);
  const [customRolePermissionsDialogOpen, setCustomRolePermissionsDialogOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<GroupItem | null>(null);
  const [selectedPermission, setSelectedPermission] = useState<PermissionItem | null>(null);
  const [selectedCustomRole, setSelectedCustomRole] = useState<CustomRoleItem | null>(null);
  const [searchUsers, setSearchUsers] = useState('');
  const [searchGroups, setSearchGroups] = useState('');
  const [searchRoles, setSearchRoles] = useState('');
  const [searchPermissions, setSearchPermissions] = useState('');

  const { data: usersData, isLoading: usersLoading } = useQuery<{ users: UserItem[] }>({
    queryKey: ['/api/users'],
  });

  const { data: groupsData, isLoading: groupsLoading } = useQuery<{ groups: GroupItem[] }>({
    queryKey: ['/api/auth/groups'],
  });

  const { data: customRolesData, isLoading: customRolesLoading } = useQuery<{ roles: CustomRoleItem[] }>({
    queryKey: ['/api/auth/custom-roles'],
  });

  const { data: permissionsData, isLoading: permissionsLoading } = useQuery<{ permissions: PermissionItem[] }>({
    queryKey: ['/api/auth/permissions'],
  });

  const { data: rolePermissionsData } = useQuery<{ rolePermissions: RolePermissionItem[] }>({
    queryKey: ['/api/auth/roles', selectedRole, 'permissions'],
    enabled: !!selectedRole,
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/auth/roles/${selectedRole}/permissions`);
      return response.json();
    },
  });

  const { data: customRolePermissionsData, isLoading: customRolePermissionsLoading } = useQuery<{
    rolePermissions: Array<{ id: string; permissionId: string; permission: PermissionItem }>;
  }>({
    queryKey: ['/api/auth/custom-roles', selectedCustomRole?.id, 'permissions'],
    enabled: customRolePermissionsDialogOpen && !!selectedCustomRole?.id,
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/auth/custom-roles/${selectedCustomRole?.id}/permissions`);
      return response.json();
    },
  });

  const updateUserRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: Role }) => {
      const response = await apiRequest('PATCH', `/api/users/${userId}/role`, { role });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({ title: t('usersAdmin.users.roleUpdated') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.users.roleUpdateError'), description: error.message, variant: 'destructive' });
    },
  });

  const updateUserCustomRole = useMutation({
    mutationFn: async ({ userId, customRoleId }: { userId: string; customRoleId: string | null }) => {
      const response = await apiRequest('PATCH', `/api/users/${userId}/custom-role`, { customRoleId });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({ title: t('usersAdmin.users.customRoleUpdated') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.users.customRoleUpdateError'), description: error.message, variant: 'destructive' });
    },
  });

  const updateUserStatus = useMutation({
    mutationFn: async ({ userId, ativo }: { userId: string; ativo: boolean }) => {
      const response = await apiRequest('PATCH', `/api/users/${userId}/status`, { ativo });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({ title: t('usersAdmin.users.statusUpdated') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.users.statusUpdateError'), description: error.message, variant: 'destructive' });
    },
  });

  const createGroup = useMutation({
    mutationFn: async (values: GroupFormData) => {
      const response = await apiRequest('POST', '/api/auth/groups', values);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/groups'] });
      setGroupDialogOpen(false);
      setSelectedGroup(null);
      toast({ title: t('usersAdmin.groups.created') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.groups.createError'), description: error.message, variant: 'destructive' });
    },
  });

  const updateGroup = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: GroupFormData }) => {
      const response = await apiRequest('PATCH', `/api/auth/groups/${id}`, values);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/groups'] });
      setGroupDialogOpen(false);
      setSelectedGroup(null);
      toast({ title: t('usersAdmin.groups.updated') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.groups.updateError'), description: error.message, variant: 'destructive' });
    },
  });

  const createCustomRole = useMutation({
    mutationFn: async (values: CustomRoleFormData) => {
      const payload = buildCustomRolePayload(values);
      const response = await apiRequest('POST', '/api/auth/custom-roles', payload);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/custom-roles'] });
      setCustomRoleDialogOpen(false);
      setSelectedCustomRole(null);
      toast({ title: t('usersAdmin.roles.created') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.roles.createError'), description: error.message, variant: 'destructive' });
    },
  });

  const updateCustomRole = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: CustomRoleFormData }) => {
      const payload = buildCustomRolePayload(values);
      const response = await apiRequest('PATCH', `/api/auth/custom-roles/${id}`, payload);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/custom-roles'] });
      setCustomRoleDialogOpen(false);
      setSelectedCustomRole(null);
      toast({ title: t('usersAdmin.roles.updated') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.roles.updateError'), description: error.message, variant: 'destructive' });
    },
  });

  const deleteCustomRole = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest('DELETE', `/api/auth/custom-roles/${id}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/custom-roles'] });
      toast({ title: t('usersAdmin.roles.deleted') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.roles.deleteError'), description: error.message, variant: 'destructive' });
    },
  });

  const deleteGroup = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest('DELETE', `/api/auth/groups/${id}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/groups'] });
      toast({ title: t('usersAdmin.groups.deleted') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.groups.deleteError'), description: error.message, variant: 'destructive' });
    },
  });

  const createPermission = useMutation({
    mutationFn: async (values: PermissionFormData) => {
      const response = await apiRequest('POST', '/api/auth/permissions', buildPermissionPayload(values));
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/permissions'] });
      setPermissionDialogOpen(false);
      setSelectedPermission(null);
      toast({ title: t('usersAdmin.permissions.created') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.permissions.createError'), description: error.message, variant: 'destructive' });
    },
  });

  const updatePermission = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: PermissionFormData }) => {
      const response = await apiRequest('PATCH', `/api/auth/permissions/${id}`, buildPermissionPayload(values));
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/permissions'] });
      setPermissionDialogOpen(false);
      setSelectedPermission(null);
      toast({ title: t('usersAdmin.permissions.updated') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.permissions.updateError'), description: error.message, variant: 'destructive' });
    },
  });

  const deletePermission = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest('DELETE', `/api/auth/permissions/${id}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/permissions'] });
      toast({ title: t('usersAdmin.permissions.deleted') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.permissions.deleteError'), description: error.message, variant: 'destructive' });
    },
  });

  const updateRolePermissions = useMutation({
    mutationFn: async (permissionCodes: string[]) => {
      const response = await apiRequest('PUT', `/api/auth/roles/${selectedRole}/permissions`, { permissionCodes });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/roles', selectedRole, 'permissions'] });
      toast({ title: t('usersAdmin.permissions.roleUpdated') });
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/roles', selectedRole, 'permissions'] });
      toast({ title: t('usersAdmin.permissions.roleUpdateError'), description: error.message, variant: 'destructive' });
    },
  });

  const updateCustomRolePermissions = useMutation({
    mutationFn: async ({ roleId, permissionCodes }: { roleId: string; permissionCodes: string[] }) => {
      const response = await apiRequest('PUT', `/api/auth/custom-roles/${roleId}/permissions`, { permissionCodes });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/custom-roles', selectedCustomRole?.id, 'permissions'] });
      toast({ title: t('usersAdmin.roles.permissionsUpdated') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.roles.permissionsUpdateError'), description: error.message, variant: 'destructive' });
    },
  });

  const users = usersData?.users ?? [];
  const groups = groupsData?.groups ?? [];
  const customRoles = customRolesData?.roles ?? [];
  const permissions = permissionsData?.permissions ?? [];
  const moduleOptions = useMemo(() => {
    const modules = new Set(permissions.map((perm) => perm.modulo).filter(Boolean));
    return Array.from(modules).sort();
  }, [permissions]);
  const resourceOptionsByModule = useMemo(() => {
    const map = new Map<string, Set<string>>();
    permissions.forEach((perm) => {
      const { modulo, recurso } = parsePermissionCode(perm.codigo);
      if (!modulo || !recurso) return;
      if (!map.has(modulo)) {
        map.set(modulo, new Set());
      }
      map.get(modulo)?.add(recurso);
    });
    return map;
  }, [permissions]);
  const actionOptions = useMemo(
    () => [
      { value: 'read', label: t('usersAdmin.permissions.actions.read') },
      { value: 'write', label: t('usersAdmin.permissions.actions.write') },
      { value: 'delete', label: t('usersAdmin.permissions.actions.delete') },
      { value: 'manage', label: t('usersAdmin.permissions.actions.manage') },
      { value: 'upload', label: t('usersAdmin.permissions.actions.upload') },
      { value: 'sync', label: t('usersAdmin.permissions.actions.sync') },
      { value: 'approve', label: t('usersAdmin.permissions.actions.approve') },
      { value: 'start', label: t('usersAdmin.permissions.actions.start') },
      { value: 'cancel', label: t('usersAdmin.permissions.actions.cancel') },
      { value: 'retry', label: t('usersAdmin.permissions.actions.retry') },
      { value: 'reconcile', label: t('usersAdmin.permissions.actions.reconcile') },
      { value: 'assign', label: t('usersAdmin.permissions.actions.assign') },
    ],
    [t]
  );
  const [rolePermissionCodes, setRolePermissionCodes] = useState<Set<string>>(new Set());
  const rolePermissionCodesRef = useRef<Set<string>>(new Set());
  const rolePermissionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rolePermissionSaveQueueRef = useRef(Promise.resolve());
  const isLockedRole = selectedRole === 'admin' || selectedRole === 'super_admin';
  const [customRolePermissionCodes, setCustomRolePermissionCodes] = useState<Set<string>>(new Set());
  const customRolePermissionCodesRef = useRef<Set<string>>(new Set());
  const customRolePermissionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customRolePermissionSaveQueueRef = useRef(Promise.resolve());

  const enqueueRolePermissionSave = (codes: string[]) => {
    if (isLockedRole) return;
    rolePermissionSaveQueueRef.current = rolePermissionSaveQueueRef.current
      .then(() => updateRolePermissions.mutateAsync(codes))
      .catch(() => undefined);
  };

  const enqueueCustomRolePermissionSave = (roleId: string, codes: string[]) => {
    customRolePermissionSaveQueueRef.current = customRolePermissionSaveQueueRef.current
      .then(() => updateCustomRolePermissions.mutateAsync({ roleId, permissionCodes: codes }))
      .catch(() => undefined);
  };

  useEffect(() => {
    const nextCodes = rolePermissionsData?.rolePermissions?.map((item) => item.permission?.codigo).filter(Boolean) ?? [];
    const nextSet = new Set(nextCodes);
    rolePermissionCodesRef.current = nextSet;
    setRolePermissionCodes(nextSet);
  }, [rolePermissionsData?.rolePermissions, selectedRole]);

  useEffect(() => {
    const nextCodes = customRolePermissionsData?.rolePermissions?.map((item) => item.permission?.codigo).filter(Boolean) ?? [];
    const nextSet = new Set(nextCodes);
    customRolePermissionCodesRef.current = nextSet;
    setCustomRolePermissionCodes(nextSet);
  }, [customRolePermissionsData?.rolePermissions, selectedCustomRole?.id]);

  useEffect(() => {
    rolePermissionSaveQueueRef.current = Promise.resolve();
    if (rolePermissionSaveTimerRef.current) {
      clearTimeout(rolePermissionSaveTimerRef.current);
      rolePermissionSaveTimerRef.current = null;
    }
    return () => {
      if (rolePermissionSaveTimerRef.current) {
        clearTimeout(rolePermissionSaveTimerRef.current);
        rolePermissionSaveTimerRef.current = null;
      }
    };
  }, [selectedRole]);

  useEffect(() => {
    customRolePermissionSaveQueueRef.current = Promise.resolve();
    if (customRolePermissionSaveTimerRef.current) {
      clearTimeout(customRolePermissionSaveTimerRef.current);
      customRolePermissionSaveTimerRef.current = null;
    }
    return () => {
      if (customRolePermissionSaveTimerRef.current) {
        clearTimeout(customRolePermissionSaveTimerRef.current);
        customRolePermissionSaveTimerRef.current = null;
      }
    };
  }, [selectedCustomRole?.id]);

  const filteredUsers = useMemo(() => {
    const query = searchUsers.toLowerCase();
    return users.filter((user) => {
      const composite = `${user.email ?? ''} ${user.firstName ?? ''} ${user.lastName ?? ''} ${user.role ?? ''} ${user.customRole?.nome ?? ''} ${user.authProvider ?? ''}`.toLowerCase();
      return composite.includes(query);
    });
  }, [users, searchUsers]);

  const filteredGroups = useMemo(() => {
    const query = searchGroups.toLowerCase();
    return groups.filter((group) => {
      const composite = `${group.nome ?? ''} ${group.descricao ?? ''}`.toLowerCase();
      return composite.includes(query);
    });
  }, [groups, searchGroups]);

  const filteredRoles = useMemo(() => {
    const query = searchRoles.toLowerCase();
    return customRoles.filter((role) => {
      const composite = `${role.nome ?? ''} ${role.slug ?? ''} ${role.descricao ?? ''} ${role.baseRole ?? ''}`.toLowerCase();
      return composite.includes(query);
    });
  }, [customRoles, searchRoles]);

  const filteredPermissions = useMemo(() => {
    const query = searchPermissions.toLowerCase();
    return permissions.filter((permission) => {
      const composite = `${permission.codigo} ${permission.nome} ${permission.modulo}`.toLowerCase();
      return composite.includes(query);
    });
  }, [permissions, searchPermissions]);

  return (
    <div className="container mx-auto p-6 max-w-7xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('usersAdmin.title')}</h1>
          <p className="text-muted-foreground">{t('usersAdmin.description')}</p>
        </div>
      </div>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users">
            <Users className="mr-2 h-4 w-4" />
            {t('usersAdmin.tabs.users')}
          </TabsTrigger>
          <TabsTrigger value="groups">
            <Layers className="mr-2 h-4 w-4" />
            {t('usersAdmin.tabs.groups')}
          </TabsTrigger>
          <TabsTrigger value="roles">
            <ShieldCheck className="mr-2 h-4 w-4" />
            {t('usersAdmin.tabs.roles')}
          </TabsTrigger>
          <TabsTrigger value="permissions">
            <Shield className="mr-2 h-4 w-4" />
            {t('usersAdmin.tabs.permissions')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card>
            <CardHeader className="space-y-2">
              <CardTitle>{t('usersAdmin.users.title')}</CardTitle>
              <CardDescription>{t('usersAdmin.users.description')}</CardDescription>
              <div className="max-w-sm">
                <Input
                  placeholder={t('usersAdmin.users.searchPlaceholder')}
                  value={searchUsers}
                  onChange={(event) => setSearchUsers(event.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('usersAdmin.users.columns.name')}</TableHead>
                    <TableHead>{t('usersAdmin.users.columns.email')}</TableHead>
                    <TableHead>{t('usersAdmin.users.columns.role')}</TableHead>
                    <TableHead>{t('usersAdmin.users.columns.customRole')}</TableHead>
                    <TableHead>{t('usersAdmin.users.columns.status')}</TableHead>
                    <TableHead>{t('usersAdmin.users.columns.provider')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        <Loader2 className="inline-block h-4 w-4 animate-spin mr-2" />
                        {t('common.loading')}
                      </TableCell>
                    </TableRow>
                  ) : filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        {t('usersAdmin.users.empty')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{formatUserName(user)}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <Select
                            value={user.role || 'viewer'}
                            onValueChange={(value) => updateUserRole.mutate({ userId: user.id, role: value as Role })}
                          >
                            <SelectTrigger className="w-[170px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {roleOptions.map((role) => (
                                <SelectItem key={role.value} value={role.value}>
                                  {role.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={user.customRoleId ?? 'none'}
                            onValueChange={(value) =>
                              updateUserCustomRole.mutate({
                                userId: user.id,
                                customRoleId: value === 'none' ? null : value,
                              })
                            }
                          >
                            <SelectTrigger className="w-[200px]">
                              <SelectValue placeholder={t('usersAdmin.users.customRolePlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{t('usersAdmin.users.customRoleNone')}</SelectItem>
                              {customRoles.map((role) => (
                                <SelectItem key={role.id} value={role.id} disabled={role.ativo === false}>
                                  {role.nome}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={user.ativo ?? false}
                            onCheckedChange={(value) => updateUserStatus.mutate({ userId: user.id, ativo: value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{user.authProvider || t('usersAdmin.users.providerLocal')}</Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="groups">
          <Card>
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle>{t('usersAdmin.groups.title')}</CardTitle>
                  <CardDescription>{t('usersAdmin.groups.description')}</CardDescription>
                </div>
                <Button onClick={() => { setSelectedGroup(null); setGroupDialogOpen(true); }}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  {t('usersAdmin.groups.new')}
                </Button>
              </div>
              <div className="max-w-sm">
                <Input
                  placeholder={t('usersAdmin.groups.searchPlaceholder')}
                  value={searchGroups}
                  onChange={(event) => setSearchGroups(event.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {groupsLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('common.loading')}
                  </div>
                ) : filteredGroups.length === 0 ? (
                  <p className="text-muted-foreground">{t('usersAdmin.groups.empty')}</p>
                ) : (
                  filteredGroups.map((group) => (
                    <div key={group.id} className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <p className="font-medium">{group.nome}</p>
                        <p className="text-xs text-muted-foreground">{group.descricao || t('usersAdmin.groups.noDescription')}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={group.ativo ? 'default' : 'secondary'}>
                          {group.ativo ? t('common.active') : t('common.inactive')}
                        </Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedGroup(group);
                            setMembersDialogOpen(true);
                          }}
                        >
                          {t('usersAdmin.groups.manageMembers')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setSelectedGroup(group);
                            setGroupDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('usersAdmin.groups.deleteTitle')}</AlertDialogTitle>
                              <AlertDialogDescription>{t('usersAdmin.groups.deleteDescription')}</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => deleteGroup.mutate(group.id)}
                              >
                                {t('common.delete')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles">
          <Card>
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle>{t('usersAdmin.roles.title')}</CardTitle>
                  <CardDescription>{t('usersAdmin.roles.description')}</CardDescription>
                </div>
                <Button onClick={() => { setSelectedCustomRole(null); setCustomRoleDialogOpen(true); }}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  {t('usersAdmin.roles.new')}
                </Button>
              </div>
              <div className="max-w-sm">
                <Input
                  placeholder={t('usersAdmin.roles.searchPlaceholder')}
                  value={searchRoles}
                  onChange={(event) => setSearchRoles(event.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {customRolesLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('common.loading')}
                  </div>
                ) : filteredRoles.length === 0 ? (
                  <p className="text-muted-foreground">{t('usersAdmin.roles.empty')}</p>
                ) : (
                  filteredRoles.map((role) => {
                    const baseLabel = roleOptions.find((item) => item.value === role.baseRole)?.label || role.baseRole;
                    return (
                      <div key={role.id} className="flex items-center justify-between rounded-md border p-3">
                        <div>
                          <p className="font-medium">{role.nome}</p>
                          <p className="text-xs text-muted-foreground">{role.slug}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Badge variant="outline">{baseLabel}</Badge>
                            <Badge variant={role.ativo ? 'default' : 'secondary'}>
                              {role.ativo ? t('common.active') : t('common.inactive')}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedCustomRole(role);
                              setCustomRolePermissionsDialogOpen(true);
                            }}
                          >
                            {t('usersAdmin.roles.managePermissions')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedCustomRole(role);
                              setCustomRoleDialogOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t('usersAdmin.roles.deleteTitle')}</AlertDialogTitle>
                                <AlertDialogDescription>{t('usersAdmin.roles.deleteDescription')}</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => deleteCustomRole.mutate(role.id)}
                                >
                                  {t('common.delete')}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissions">
          <Card>
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle>{t('usersAdmin.permissions.title')}</CardTitle>
                  <CardDescription>{t('usersAdmin.permissions.description')}</CardDescription>
                </div>
                <Button onClick={() => { setSelectedPermission(null); setPermissionDialogOpen(true); }}>
                  {t('usersAdmin.permissions.new')}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <div className="w-[220px]">
                  <Label>{t('usersAdmin.permissions.roleLabel')}</Label>
                  <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as Role)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((role) => (
                        <SelectItem key={role.value} value={role.value}>
                          {role.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {isLockedRole && (
                  <Badge variant="secondary">{t('usersAdmin.permissions.roleAlwaysAllowed')}</Badge>
                )}
                <div className="flex-1 min-w-[240px]">
                  <Label>{t('usersAdmin.permissions.searchLabel')}</Label>
                  <Input
                    placeholder={t('usersAdmin.permissions.searchPlaceholder')}
                    value={searchPermissions}
                    onChange={(event) => setSearchPermissions(event.target.value)}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('usersAdmin.permissions.columns.permission')}</TableHead>
                    <TableHead>{t('usersAdmin.permissions.columns.module')}</TableHead>
                    <TableHead>{t('usersAdmin.permissions.columns.roleAccess')}</TableHead>
                    <TableHead>{t('usersAdmin.permissions.columns.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {permissionsLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        <Loader2 className="inline-block h-4 w-4 animate-spin mr-2" />
                        {t('common.loading')}
                      </TableCell>
                    </TableRow>
                  ) : filteredPermissions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        {t('usersAdmin.permissions.empty')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredPermissions.map((permission) => {
                      const hasRole = rolePermissionCodes.has(permission.codigo);
                      return (
                        <TableRow key={permission.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{permission.nome}</p>
                              <p className="text-xs text-muted-foreground">{permission.codigo}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{permission.modulo}</Badge>
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={isLockedRole ? true : hasRole}
                              disabled={isLockedRole}
                              onCheckedChange={(checked) => {
                                if (isLockedRole) {
                                  return;
                                }
                                setRolePermissionCodes((currentCodes) => {
                                  const nextCodes = new Set(currentCodes);
                                  if (checked) {
                                    nextCodes.add(permission.codigo);
                                  } else {
                                    nextCodes.delete(permission.codigo);
                                  }
                                  rolePermissionCodesRef.current = nextCodes;
                                  if (rolePermissionSaveTimerRef.current) {
                                    clearTimeout(rolePermissionSaveTimerRef.current);
                                  }
                                  rolePermissionSaveTimerRef.current = setTimeout(() => {
                                    enqueueRolePermissionSave(Array.from(rolePermissionCodesRef.current));
                                  }, 300);
                                  return nextCodes;
                                });
                              }}
                            />
                          </TableCell>
                          <TableCell className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedPermission(permission);
                                setPermissionDialogOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{t('usersAdmin.permissions.deleteTitle')}</AlertDialogTitle>
                                  <AlertDialogDescription>{t('usersAdmin.permissions.deleteDescription')}</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() => deletePermission.mutate(permission.id)}
                                  >
                                    {t('common.delete')}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <GroupFormDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        group={selectedGroup}
        isLoading={createGroup.isPending || updateGroup.isPending}
        onSubmit={(values) => {
          if (selectedGroup) {
            updateGroup.mutate({ id: selectedGroup.id, values });
          } else {
            createGroup.mutate(values);
          }
        }}
      />

      <CustomRoleFormDialog
        open={customRoleDialogOpen}
        onOpenChange={(openValue) => {
          setCustomRoleDialogOpen(openValue);
          if (!openValue) {
            setSelectedCustomRole(null);
          }
        }}
        role={selectedCustomRole}
        isLoading={createCustomRole.isPending || updateCustomRole.isPending}
        onSubmit={(values) => {
          if (selectedCustomRole) {
            updateCustomRole.mutate({ id: selectedCustomRole.id, values });
          } else {
            createCustomRole.mutate(values);
          }
        }}
      />

      <PermissionFormDialog
        open={permissionDialogOpen}
        onOpenChange={setPermissionDialogOpen}
        permission={selectedPermission}
        moduleOptions={moduleOptions}
        resourceOptionsByModule={resourceOptionsByModule}
        actionOptions={actionOptions}
        isLoading={createPermission.isPending || updatePermission.isPending}
        onSubmit={(values) => {
          if (selectedPermission) {
            updatePermission.mutate({ id: selectedPermission.id, values });
          } else {
            createPermission.mutate(values);
          }
        }}
      />

      <Dialog
        open={customRolePermissionsDialogOpen}
        onOpenChange={(openValue) => {
          setCustomRolePermissionsDialogOpen(openValue);
          if (!openValue) {
            setSelectedCustomRole(null);
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('usersAdmin.roles.permissionsTitle')}</DialogTitle>
            <DialogDescription>
              {selectedCustomRole ? t('usersAdmin.roles.permissionsDescription', { name: selectedCustomRole.nome }) : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="max-w-sm">
              <Input
                placeholder={t('usersAdmin.permissions.searchPlaceholder')}
                value={searchPermissions}
                onChange={(event) => setSearchPermissions(event.target.value)}
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('usersAdmin.permissions.columns.permission')}</TableHead>
                  <TableHead>{t('usersAdmin.permissions.columns.module')}</TableHead>
                  <TableHead>{t('usersAdmin.permissions.columns.roleAccess')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {permissionsLoading || customRolePermissionsLoading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      <Loader2 className="inline-block h-4 w-4 animate-spin mr-2" />
                      {t('common.loading')}
                    </TableCell>
                  </TableRow>
                ) : filteredPermissions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      {t('usersAdmin.permissions.empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPermissions.map((permission) => {
                    const hasRole = customRolePermissionCodes.has(permission.codigo);
                    return (
                      <TableRow key={permission.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{permission.nome}</p>
                            <p className="text-xs text-muted-foreground">{permission.codigo}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{permission.modulo}</Badge>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={hasRole}
                            disabled={!selectedCustomRole}
                            onCheckedChange={(checked) => {
                              if (!selectedCustomRole) return;
                              setCustomRolePermissionCodes((currentCodes) => {
                                const nextCodes = new Set(currentCodes);
                                if (checked) {
                                  nextCodes.add(permission.codigo);
                                } else {
                                  nextCodes.delete(permission.codigo);
                                }
                                customRolePermissionCodesRef.current = nextCodes;
                                if (customRolePermissionSaveTimerRef.current) {
                                  clearTimeout(customRolePermissionSaveTimerRef.current);
                                }
                                customRolePermissionSaveTimerRef.current = setTimeout(() => {
                                  enqueueCustomRolePermissionSave(
                                    selectedCustomRole.id,
                                    Array.from(customRolePermissionCodesRef.current)
                                  );
                                }, 300);
                                return nextCodes;
                              });
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCustomRolePermissionsDialogOpen(false)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GroupMembersDialog
        open={membersDialogOpen}
        onOpenChange={setMembersDialogOpen}
        group={selectedGroup}
        users={users}
      />
    </div>
  );
}
