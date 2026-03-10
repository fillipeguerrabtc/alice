/**
 * Página de Gestão de Usuários/Grupos/Permissões - Alice Enterprise Platform
 *
 * Regra 6: Dados reais via API PostgreSQL (sem mocks)
 * Regra 10: Documentação PT-BR
 * Regra 13: Internacionalização i18next
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { WorkspaceFilterBar } from '@/components/ui/workspace-filter-bar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Users, Shield, Layers, ShieldCheck } from 'lucide-react';
import { UsersTabContent } from '@/pages/users-admin/components/users-tab-content';
import { GroupsTabContent } from '@/pages/users-admin/components/groups-tab-content';
import { RolesTabContent } from '@/pages/users-admin/components/roles-tab-content';
import { PermissionsTabContent } from '@/pages/users-admin/components/permissions-tab-content';
import { CustomRolePermissionsDialog } from '@/pages/users-admin/components/custom-role-permissions-dialog';
import { UserDialogProfileSection, type UserDialogProfileState } from '@/pages/users-admin/components/user-dialog-profile-section';
import { UserDialogRolesSection } from '@/pages/users-admin/components/user-dialog-roles-section';
import { UserDialogCustomRolesSection } from '@/pages/users-admin/components/user-dialog-custom-roles-section';
import { UserDialogGroupsSection } from '@/pages/users-admin/components/user-dialog-groups-section';
import { GroupFormDialog } from '@/pages/users-admin/components/group-form-dialog';
import { CustomRoleFormDialog } from '@/pages/users-admin/components/custom-role-form-dialog';
import { PermissionFormDialog } from '@/pages/users-admin/components/permission-form-dialog';
import { GroupMembersDialog } from '@/pages/users-admin/components/group-members-dialog';
import { useRolePermissionOrchestration } from '@/pages/users-admin/hooks/use-role-permission-orchestration';
import { createInitialUserDialogForm, useUserManagement } from '@/pages/users-admin/hooks/use-user-management';
import {
  buildCustomRolePayload,
  buildPermissionPayload,
  parsePermissionCode,
  type CustomRoleFormData,
  type GroupFormData,
  type PermissionFormData,
} from '@/pages/users-admin/form-schemas';
import type {
  CustomRoleItem,
  GroupItem,
  PermissionItem,
  Role,
  RolePermissionItem,
  UserDialogFormState,
  UserItem,
  UsersAdminTabKey,
  UsersAdminWorkspaceKey,
} from '@/pages/users-admin/types';

type UsersAdminTabDescriptor = {
  value: UsersAdminTabKey;
  icon: typeof Users;
  labelKey: string;
};

const roleOptions: Array<{ value: Role; label: string }> = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Administrador' },
  { value: 'manager', label: 'Gerente' },
  { value: 'operator', label: 'Operador' },
  { value: 'viewer', label: 'Visualizador' },
  { value: 'guest', label: 'Convidado' },
];

const USERS_ADMIN_TAB_DESCRIPTORS: UsersAdminTabDescriptor[] = [
  { value: 'users', icon: Users, labelKey: 'usersAdmin.tabs.users' },
  { value: 'groups', icon: Layers, labelKey: 'usersAdmin.tabs.groups' },
  { value: 'roles', icon: ShieldCheck, labelKey: 'usersAdmin.tabs.roles' },
  { value: 'permissions', icon: Shield, labelKey: 'usersAdmin.tabs.permissions' },
];

const USERS_ADMIN_WORKSPACE_TABS: Record<UsersAdminWorkspaceKey, UsersAdminTabKey[]> = {
  all: USERS_ADMIN_TAB_DESCRIPTORS.map((tab) => tab.value),
  identity: ['users', 'groups'],
  access: ['roles', 'permissions'],
};

const USERS_ADMIN_WORKSPACE_LABELS: Array<{ value: UsersAdminWorkspaceKey; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'identity', label: 'Identidade' },
  { value: 'access', label: 'Acesso & RBAC' },
];

function formatFullName(user: Pick<UserItem, 'firstName' | 'lastName' | 'email'>) {
  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return fullName || user.email || 'Usuário';
}

export default function UsersAdmin() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<UsersAdminTabKey>('users');
  const [activeWorkspace, setActiveWorkspace] = useState<UsersAdminWorkspaceKey>('all');
  const [selectedRole, setSelectedRole] = useState<Role>('admin');
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [customRoleDialogOpen, setCustomRoleDialogOpen] = useState(false);
  const [customRolePermissionsDialogOpen, setCustomRolePermissionsDialogOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<GroupItem | null>(null);
  const [selectedPermission, setSelectedPermission] = useState<PermissionItem | null>(null);
  const [selectedCustomRole, setSelectedCustomRole] = useState<CustomRoleItem | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userDialogMode, setUserDialogMode] = useState<'create' | 'edit'>('edit');
  const [userForm, setUserForm] = useState<UserDialogFormState>(createInitialUserDialogForm());
  const [searchUsers, setSearchUsers] = useState('');
  const [searchGroups, setSearchGroups] = useState('');
  const [searchRoles, setSearchRoles] = useState('');
  const [searchPermissions, setSearchPermissions] = useState('');
  const [searchCustomRolePermissions, setSearchCustomRolePermissions] = useState('');

  const visibleTabs = useMemo(() => {
    const allowed = USERS_ADMIN_WORKSPACE_TABS[activeWorkspace];
    return USERS_ADMIN_TAB_DESCRIPTORS.filter((tab) => allowed.includes(tab.value));
  }, [activeWorkspace]);

  const handleWorkspaceChange = useCallback((workspace: UsersAdminWorkspaceKey) => {
    setActiveWorkspace(workspace);
    if (workspace === 'all') return;
    const allowed = USERS_ADMIN_WORKSPACE_TABS[workspace];
    if (!allowed.includes(activeTab)) {
      setActiveTab(allowed[0] ?? 'users');
    }
  }, [activeTab]);

  const handleTabChange = useCallback((value: string) => {
    const normalized = USERS_ADMIN_TAB_DESCRIPTORS.find((tab) => tab.value === value)?.value;
    if (!normalized) return;
    setActiveTab(normalized);
    if (activeWorkspace !== 'all' && !USERS_ADMIN_WORKSPACE_TABS[activeWorkspace].includes(normalized)) {
      setActiveWorkspace('all');
    }
  }, [activeWorkspace]);

  const { data: usersData, isLoading: usersLoading } = useQuery<{ users: UserItem[] }>({
    queryKey: ['/api/users'],
  });

  const { data: groupsData, isLoading: groupsLoading } = useQuery<{ groups: GroupItem[] }>({
    queryKey: ['/api/auth/groups'],
  });

  const { data: customRolesData, isLoading: customRolesLoading } = useQuery<{ roles: CustomRoleItem[] }>({
    queryKey: ['/api/auth/custom-roles'],
  });

  const { data: baseRolesData } = useQuery<{ roles: Array<{ role: Role; descricao: string }> }>({
    queryKey: ['/api/auth/roles'],
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

  useEffect(() => {
    if (!selectedUser) return;
    setUserForm({
      email: selectedUser.email || '',
      password: '',
      firstName: selectedUser.firstName || '',
      lastName: selectedUser.lastName || '',
      preferredName: selectedUser.preferredName || '',
      cargo: selectedUser.cargo || '',
      departamento: selectedUser.departamento || '',
      telefone: selectedUser.telefone || '',
      ativo: selectedUser.ativo ?? true,
      roles: selectedUser.roles && selectedUser.roles.length > 0
        ? [...selectedUser.roles]
        : selectedUser.role
          ? [selectedUser.role]
          : [],
      customRoleIds: selectedUser.customRoles?.map((role) => role.id)
        ?? (selectedUser.customRole ? [selectedUser.customRole.id] : []),
      groupIds: selectedUser.groups?.map((group) => group.id) ?? [],
    });
  }, [selectedUser]);

  const currentUserRoles = currentUser?.roles
    ?? (currentUser?.role ? [currentUser.role] : []);
  const isAdminRole = currentUserRoles.includes('super_admin') || currentUserRoles.includes('admin');
  const assignmentsDisabled = !isAdminRole;
  const { handleSaveUser, handleToggleUserStatus, isSavingUser } = useUserManagement({
    isAdminRole,
    selectedUser,
    setUserDialogOpen,
    setUserForm,
    t,
    toast,
    userDialogMode,
    userForm,
  });

  const canEditUser = (user: UserItem) => {
    if (!currentUser) return false;
    if (isAdminRole) return true;
    return currentUser.id === user.id;
  };
  const handleCreateUser = () => {
    setSelectedUser(null);
    setUserDialogMode('create');
    setUserForm(createInitialUserDialogForm());
    setUserDialogOpen(true);
  };
  const handleEditUser = (user: UserItem) => {
    setSelectedUser(user);
    setUserDialogMode('edit');
    setUserDialogOpen(true);
  };
  const handleUserProfileFieldChange = useCallback(
    (field: keyof Omit<UserDialogProfileState, 'ativo'>, value: string) => {
      setUserForm((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleUserStatusChange = useCallback((ativo: boolean) => {
    setUserForm((prev) => ({ ...prev, ativo }));
  }, []);

  const handleUserRolesChange = useCallback((roles: Role[]) => {
    setUserForm((prev) => ({ ...prev, roles }));
  }, []);

  const handleUserCustomRoleIdsChange = useCallback((customRoleIds: string[]) => {
    setUserForm((prev) => ({ ...prev, customRoleIds }));
  }, []);

  const handleUserGroupIdsChange = useCallback((groupIds: string[]) => {
    setUserForm((prev) => ({ ...prev, groupIds }));
  }, []);

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
  const handleCreateCustomRole = () => {
    setSelectedCustomRole(null);
    setCustomRoleDialogOpen(true);
  };
  const handleManageBaseRolePermissions = (role: Role) => {
    setSelectedRole(role);
    setActiveTab('permissions');
  };
  const handleManageCustomRolePermissions = (role: CustomRoleItem) => {
    setSelectedCustomRole(role);
    setCustomRolePermissionsDialogOpen(true);
  };
  const handleEditCustomRole = (role: CustomRoleItem) => {
    setSelectedCustomRole(role);
    setCustomRoleDialogOpen(true);
  };
  const handleDeleteCustomRole = (roleId: string) => {
    deleteCustomRole.mutate(roleId);
  };

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
  const handleCreateGroup = () => {
    setSelectedGroup(null);
    setGroupDialogOpen(true);
  };
  const handleManageGroupMembers = (group: GroupItem) => {
    setSelectedGroup(group);
    setMembersDialogOpen(true);
  };
  const handleEditGroup = (group: GroupItem) => {
    setSelectedGroup(group);
    setGroupDialogOpen(true);
  };
  const handleDeleteGroup = (groupId: string) => {
    deleteGroup.mutate(groupId);
  };

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

  const users = usersData?.users ?? [];
  const groups = groupsData?.groups ?? [];
  const customRoles = customRolesData?.roles ?? [];
  const baseRoles = baseRolesData?.roles ?? roleOptions.map((role) => ({ role: role.value, descricao: role.label }));
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
  const {
    customRolePermissionCodes,
    flushCustomRolePermissionSave,
    handleCustomRolePermissionToggle,
    handleRolePermissionToggle,
    isLockedRole,
    rolePermissionCodes,
  } = useRolePermissionOrchestration({
    customRolePermissionsData,
    rolePermissionsData,
    selectedCustomRole,
    selectedRole,
    t,
    toast,
  });

  const filteredUsers = useMemo(() => {
    const query = searchUsers.toLowerCase();
    return users.filter((user) => {
      const baseRoles = user.roles?.join(' ') ?? user.role ?? '';
      const customRoles = user.customRoles?.map((role) => role.nome).join(' ') ?? user.customRole?.nome ?? '';
      const composite = `${user.email ?? ''} ${user.firstName ?? ''} ${user.lastName ?? ''} ${user.preferredName ?? ''} ${baseRoles} ${customRoles} ${user.authProvider ?? ''}`.toLowerCase();
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
  const handleCreatePermission = () => {
    setSelectedPermission(null);
    setPermissionDialogOpen(true);
  };
  const handleEditPermission = (permission: PermissionItem) => {
    setSelectedPermission(permission);
    setPermissionDialogOpen(true);
  };
  const handleDeletePermission = (permissionId: string) => {
    deletePermission.mutate(permissionId);
  };
  const filteredCustomRolePermissions = useMemo(() => {
    const query = searchCustomRolePermissions.toLowerCase();
    return permissions.filter((permission) => {
      const composite = `${permission.codigo} ${permission.nome} ${permission.modulo}`.toLowerCase();
      return composite.includes(query);
    });
  }, [permissions, searchCustomRolePermissions]);
  const handleCustomRolePermissionsDialogOpenChange = (openValue: boolean) => {
    setCustomRolePermissionsDialogOpen(openValue);
    if (!openValue) {
      setSearchCustomRolePermissions('');
      flushCustomRolePermissionSave();
      setSelectedCustomRole(null);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('usersAdmin.title')}</h1>
          <p className="text-muted-foreground">{t('usersAdmin.description')}</p>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="space-y-4"
      >
        <WorkspaceFilterBar
          activeWorkspace={activeWorkspace}
          options={USERS_ADMIN_WORKSPACE_LABELS.map((workspace) => ({
            value: workspace.value,
            label: workspace.label,
          }))}
          onWorkspaceChange={handleWorkspaceChange}
          getTestId={(workspace) => `users-admin-workspace-${workspace}`}
        />
        <div className="w-full min-w-0 overflow-x-auto pb-2 -mx-2 px-2 md:mx-0 md:px-0">
          <TabsList className="inline-flex min-w-max flex-nowrap items-center gap-1 whitespace-nowrap">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger key={tab.value} value={tab.value} className="whitespace-nowrap shrink-0">
                  <Icon className="mr-2 h-4 w-4" />
                  {t(tab.labelKey)}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <TabsContent value="users">
          <UsersTabContent
            canCreateUser={isAdminRole}
            canEditUser={canEditUser}
            filteredUsers={filteredUsers}
            formatFullName={formatFullName}
            onCreateUser={handleCreateUser}
            onEditUser={handleEditUser}
            onSearchUsersChange={setSearchUsers}
            onToggleUserStatus={handleToggleUserStatus}
            roleOptions={roleOptions}
            searchUsers={searchUsers}
            t={t}
            usersLoading={usersLoading}
          />
        </TabsContent>

        <TabsContent value="groups">
          <GroupsTabContent
            filteredGroups={filteredGroups}
            groupsLoading={groupsLoading}
            onCreateGroup={handleCreateGroup}
            onDeleteGroup={handleDeleteGroup}
            onEditGroup={handleEditGroup}
            onManageMembers={handleManageGroupMembers}
            onSearchGroupsChange={setSearchGroups}
            searchGroups={searchGroups}
            t={t}
          />
        </TabsContent>

        <TabsContent value="roles">
          <RolesTabContent
            baseRoles={baseRoles}
            customRolesLoading={customRolesLoading}
            filteredRoles={filteredRoles}
            onCreateRole={handleCreateCustomRole}
            onDeleteRole={handleDeleteCustomRole}
            onEditRole={handleEditCustomRole}
            onManageBasePermissions={handleManageBaseRolePermissions}
            onManageRolePermissions={handleManageCustomRolePermissions}
            onSearchRolesChange={setSearchRoles}
            roleOptions={roleOptions}
            searchRoles={searchRoles}
            t={t}
          />
        </TabsContent>

        <TabsContent value="permissions">
          <PermissionsTabContent
            filteredPermissions={filteredPermissions}
            isLockedRole={isLockedRole}
            permissionsLoading={permissionsLoading}
            roleOptions={roleOptions}
            rolePermissionCodes={rolePermissionCodes}
            searchPermissions={searchPermissions}
            selectedRole={selectedRole}
            t={t}
            onCreatePermission={handleCreatePermission}
            onDeletePermission={handleDeletePermission}
            onEditPermission={handleEditPermission}
            onRolePermissionToggle={handleRolePermissionToggle}
            onSearchPermissionsChange={setSearchPermissions}
            onSelectedRoleChange={setSelectedRole}
          />
        </TabsContent>
      </Tabs>

      <Dialog
        open={userDialogOpen}
        onOpenChange={(openValue) => {
          setUserDialogOpen(openValue);
          if (!openValue) {
            setSelectedUser(null);
            setUserDialogMode('edit');
            setUserForm((prev) => ({ ...prev, password: '' }));
          }
        }}
      >
        <DialogContent className="max-w-3xl h-[85vh] max-h-[85vh] flex flex-col overflow-hidden min-h-0">
          <DialogHeader>
            <DialogTitle>
              {userDialogMode === 'create' ? t('usersAdmin.users.newTitle') : t('usersAdmin.users.editTitle')}
            </DialogTitle>
            <DialogDescription>
              {userDialogMode === 'create' ? t('usersAdmin.users.newDescription') : t('usersAdmin.users.editDescription')}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4 min-h-0">
            <div className="space-y-6">
              <UserDialogProfileSection
                assignmentsDisabled={assignmentsDisabled}
                isAdminRole={isAdminRole}
                mode={userDialogMode}
                onActiveChange={handleUserStatusChange}
                onFieldChange={handleUserProfileFieldChange}
                state={userForm}
                t={t}
              />

              <UserDialogRolesSection
                assignmentsDisabled={assignmentsDisabled}
                onRolesChange={handleUserRolesChange}
                roleOptions={roleOptions}
                selectedRoles={userForm.roles}
                t={t}
              />

              <UserDialogCustomRolesSection
                assignmentsDisabled={assignmentsDisabled}
                customRoles={customRoles}
                onCustomRoleIdsChange={handleUserCustomRoleIdsChange}
                selectedCustomRoleIds={userForm.customRoleIds}
                t={t}
              />

              <UserDialogGroupsSection
                assignmentsDisabled={assignmentsDisabled}
                groups={groups}
                onGroupIdsChange={handleUserGroupIdsChange}
                selectedGroupIds={userForm.groupIds}
                t={t}
              />
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUserDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSaveUser} disabled={isSavingUser}>
              {isSavingUser ? t('common.save') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        roleOptions={roleOptions}
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

      <CustomRolePermissionsDialog
        customRolePermissionsLoading={customRolePermissionsLoading}
        filteredPermissions={filteredCustomRolePermissions}
        onClose={() => handleCustomRolePermissionsDialogOpenChange(false)}
        onOpenChange={handleCustomRolePermissionsDialogOpenChange}
        onSearchChange={setSearchCustomRolePermissions}
        onTogglePermission={handleCustomRolePermissionToggle}
        open={customRolePermissionsDialogOpen}
        permissionCodes={customRolePermissionCodes}
        permissionsLoading={permissionsLoading}
        searchQuery={searchCustomRolePermissions}
        selectedRole={selectedCustomRole}
        t={t}
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
