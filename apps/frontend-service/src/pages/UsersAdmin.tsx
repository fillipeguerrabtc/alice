/**
 * Página de Gestão de Usuários/Grupos/Permissões - Alice Enterprise Platform
 *
 * Regra 6: Dados reais via API PostgreSQL (sem mocks)
 * Regra 10: Documentação PT-BR
 * Regra 13: Internacionalização i18next
 */

import { useEffect, useMemo, useState } from 'react';
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
import { Loader2, Users, Shield, Layers, UserPlus, Pencil, Trash2 } from 'lucide-react';

type Role = 'super_admin' | 'admin' | 'manager' | 'operator' | 'viewer' | 'guest';

type UserItem = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role?: Role | null;
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

const groupFormSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(255),
  descricao: z.string().optional(),
  ativo: z.boolean().optional(),
});

type GroupFormData = z.infer<typeof groupFormSchema>;

const permissionFormSchema = z.object({
  codigo: z.string().min(2, 'Código deve ter pelo menos 2 caracteres').max(100),
  nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(255),
  descricao: z.string().optional(),
  modulo: z.string().min(2, 'Módulo é obrigatório').max(100),
});

type PermissionFormData = z.infer<typeof permissionFormSchema>;

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
    form.reset({
      nome: group?.nome || '',
      descricao: group?.descricao || '',
      ativo: group?.ativo ?? true,
    });
  }, [form, group?.ativo, group?.descricao, group?.id, group?.nome]);

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

function PermissionFormDialog({
  open,
  onOpenChange,
  permission,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  permission?: PermissionItem | null;
  onSubmit: (data: PermissionFormData) => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const form = useForm<PermissionFormData>({
    resolver: asResolver<PermissionFormData>(zodResolver(permissionFormSchema)),
    defaultValues: {
      codigo: permission?.codigo || '',
      nome: permission?.nome || '',
      descricao: permission?.descricao || '',
      modulo: permission?.modulo || '',
    },
  });

  useEffect(() => {
    form.reset({
      codigo: permission?.codigo || '',
      nome: permission?.nome || '',
      descricao: permission?.descricao || '',
      modulo: permission?.modulo || '',
    });
  }, [form, permission?.codigo, permission?.descricao, permission?.id, permission?.modulo, permission?.nome]);

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
            <FormField
              control={form.control}
              name="codigo"
              render={({ field }: { field: ControllerRenderProps<PermissionFormData, 'codigo'> }) => (
                <FormItem>
                  <FormLabel>{t('usersAdmin.permissions.fields.code')}</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={!!permission} data-testid="input-permission-code" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                    <Input {...field} data-testid="input-permission-module" />
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
  const [selectedGroup, setSelectedGroup] = useState<GroupItem | null>(null);
  const [selectedPermission, setSelectedPermission] = useState<PermissionItem | null>(null);
  const [searchUsers, setSearchUsers] = useState('');
  const [searchGroups, setSearchGroups] = useState('');
  const [searchPermissions, setSearchPermissions] = useState('');

  const { data: usersData, isLoading: usersLoading } = useQuery<{ users: UserItem[] }>({
    queryKey: ['/api/users'],
  });

  const { data: groupsData, isLoading: groupsLoading } = useQuery<{ groups: GroupItem[] }>({
    queryKey: ['/api/auth/groups'],
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
      const response = await apiRequest('POST', '/api/auth/permissions', values);
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
      const response = await apiRequest('PATCH', `/api/auth/permissions/${id}`, values);
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

  const users = usersData?.users ?? [];
  const groups = groupsData?.groups ?? [];
  const permissions = permissionsData?.permissions ?? [];
  const [rolePermissionCodes, setRolePermissionCodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    const nextCodes = rolePermissionsData?.rolePermissions?.map((item) => item.permission?.codigo).filter(Boolean) ?? [];
    setRolePermissionCodes(new Set(nextCodes));
  }, [rolePermissionsData?.rolePermissions, selectedRole]);

  const filteredUsers = useMemo(() => {
    const query = searchUsers.toLowerCase();
    return users.filter((user) => {
      const composite = `${user.email ?? ''} ${user.firstName ?? ''} ${user.lastName ?? ''} ${user.role ?? ''} ${user.authProvider ?? ''}`.toLowerCase();
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
                    <TableHead>{t('usersAdmin.users.columns.status')}</TableHead>
                    <TableHead>{t('usersAdmin.users.columns.provider')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        <Loader2 className="inline-block h-4 w-4 animate-spin mr-2" />
                        {t('common.loading')}
                      </TableCell>
                    </TableRow>
                  ) : filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
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
                              checked={hasRole}
                              onCheckedChange={(checked) => {
                                setRolePermissionCodes((currentCodes) => {
                                  const nextCodes = new Set(currentCodes);
                                  if (checked) {
                                    nextCodes.add(permission.codigo);
                                  } else {
                                    nextCodes.delete(permission.codigo);
                                  }
                                  updateRolePermissions.mutate(Array.from(nextCodes));
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

      <PermissionFormDialog
        open={permissionDialogOpen}
        onOpenChange={setPermissionDialogOpen}
        permission={selectedPermission}
        isLoading={createPermission.isPending || updatePermission.isPending}
        onSubmit={(values) => {
          if (selectedPermission) {
            updatePermission.mutate({ id: selectedPermission.id, values });
          } else {
            createPermission.mutate(values);
          }
        }}
      />

      <GroupMembersDialog
        open={membersDialogOpen}
        onOpenChange={setMembersDialogOpen}
        group={selectedGroup}
        users={users}
      />
    </div>
  );
}
