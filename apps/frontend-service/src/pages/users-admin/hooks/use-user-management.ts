import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { Role, UserDialogFormState, UserItem } from '@/pages/users-admin/types';

type UserManagementToast = (options: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

type UseUserManagementParams = {
  isAdminRole: boolean;
  selectedUser: UserItem | null;
  setUserDialogOpen: (open: boolean) => void;
  setUserForm: Dispatch<SetStateAction<UserDialogFormState>>;
  t: TFunction;
  toast: UserManagementToast;
  userDialogMode: 'create' | 'edit';
  userForm: UserDialogFormState;
};

export function createInitialUserDialogForm(): UserDialogFormState {
  return {
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    preferredName: '',
    cargo: '',
    departamento: '',
    telefone: '',
    ativo: true,
    roles: [],
    customRoleIds: [],
    groupIds: [],
  };
}

export function useUserManagement({
  isAdminRole,
  selectedUser,
  setUserDialogOpen,
  setUserForm,
  t,
  toast,
  userDialogMode,
  userForm,
}: UseUserManagementParams) {
  const updateUserProfile = useMutation({
    mutationFn: async ({ userId, payload }: { userId: string; payload: Record<string, unknown> }) => {
      const response = await apiRequest('PATCH', `/api/users/${userId}`, payload);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
  });

  const updateUserPassword = useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      const response = await apiRequest('PATCH', `/api/users/${userId}/password`, { newPassword });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
  });

  const createUser = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await apiRequest('POST', '/api/auth/register', payload);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json() as Promise<{ user: UserItem }>;
    },
  });

  const updateUserRoles = useMutation({
    mutationFn: async ({ userId, roles }: { userId: string; roles: Role[] }) => {
      const response = await apiRequest('PATCH', `/api/users/${userId}/roles`, { roles });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
  });

  const updateUserCustomRoles = useMutation({
    mutationFn: async ({ userId, customRoleIds }: { userId: string; customRoleIds: string[] }) => {
      const response = await apiRequest('PATCH', `/api/users/${userId}/custom-roles`, { customRoleIds });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
  });

  const updateUserGroups = useMutation({
    mutationFn: async ({ userId, groupIds }: { userId: string; groupIds: string[] }) => {
      const response = await apiRequest('PATCH', `/api/users/${userId}/groups`, { groupIds });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
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

  const handleSaveUser = useCallback(async () => {
    if (userDialogMode === 'edit' && !selectedUser) return;
    const trimmedEmail = userForm.email.trim();
    const trimmedPassword = userForm.password.trim();
    const trimmedFirstName = userForm.firstName.trim();
    const trimmedLastName = userForm.lastName.trim();
    const trimmedCargo = userForm.cargo.trim();
    const trimmedDepartamento = userForm.departamento.trim();
    const trimmedTelefone = userForm.telefone.trim();

    if (!trimmedEmail || !trimmedFirstName || !trimmedLastName || !trimmedCargo || !trimmedDepartamento || !trimmedTelefone) {
      toast({ title: t('usersAdmin.users.requiredFieldsError'), variant: 'destructive' });
      return;
    }
    if (userDialogMode === 'create' && !trimmedPassword) {
      toast({ title: t('usersAdmin.users.requiredPasswordError'), variant: 'destructive' });
      return;
    }
    if (userDialogMode === 'edit' && trimmedPassword && trimmedPassword.length < 8) {
      toast({ title: t('usersAdmin.users.passwordMinError'), variant: 'destructive' });
      return;
    }
    if (userForm.roles.length === 0) {
      toast({ title: t('usersAdmin.users.requiredRolesError'), variant: 'destructive' });
      return;
    }

    try {
      let targetUserId = selectedUser?.id ?? '';

      if (userDialogMode === 'create') {
        const created = await createUser.mutateAsync({
          email: trimmedEmail,
          password: trimmedPassword,
          firstName: trimmedFirstName,
          lastName: trimmedLastName,
          cargo: trimmedCargo,
          departamento: trimmedDepartamento,
          telefone: trimmedTelefone,
          preferredName: userForm.preferredName || undefined,
        });
        targetUserId = created.user.id;
      } else if (selectedUser) {
        await updateUserProfile.mutateAsync({
          userId: selectedUser.id,
          payload: {
            email: isAdminRole ? trimmedEmail : undefined,
            firstName: trimmedFirstName,
            lastName: trimmedLastName,
            preferredName: userForm.preferredName || undefined,
            cargo: trimmedCargo,
            departamento: trimmedDepartamento,
            telefone: trimmedTelefone,
          },
        });
      }

      if (isAdminRole && targetUserId) {
        if (userForm.roles.length > 0) {
          await updateUserRoles.mutateAsync({ userId: targetUserId, roles: userForm.roles });
        }
        await updateUserCustomRoles.mutateAsync({ userId: targetUserId, customRoleIds: userForm.customRoleIds });
        await updateUserGroups.mutateAsync({ userId: targetUserId, groupIds: userForm.groupIds });
        await updateUserStatus.mutateAsync({ userId: targetUserId, ativo: userForm.ativo });
      }

      if (userDialogMode === 'edit' && isAdminRole && targetUserId && trimmedPassword) {
        await updateUserPassword.mutateAsync({ userId: targetUserId, newPassword: trimmedPassword });
        toast({ title: t('usersAdmin.users.passwordUpdated') });
      }

      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({ title: t('usersAdmin.users.updated') });
      setUserDialogOpen(false);
      setUserForm((previous) => ({ ...previous, password: '' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('errors.generic');
      toast({ title: t('usersAdmin.users.updateError'), description: message, variant: 'destructive' });
    }
  }, [
    createUser,
    isAdminRole,
    selectedUser,
    setUserDialogOpen,
    setUserForm,
    t,
    toast,
    updateUserCustomRoles,
    updateUserGroups,
    updateUserPassword,
    updateUserProfile,
    updateUserRoles,
    updateUserStatus,
    userDialogMode,
    userForm,
  ]);

  const handleToggleUserStatus = useCallback((userId: string, ativo: boolean) => {
    updateUserStatus.mutate({ userId, ativo });
  }, [updateUserStatus]);

  const isSavingUser = updateUserProfile.isPending
    || createUser.isPending
    || updateUserRoles.isPending
    || updateUserCustomRoles.isPending
    || updateUserGroups.isPending
    || updateUserStatus.isPending
    || updateUserPassword.isPending;

  return {
    handleSaveUser,
    handleToggleUserStatus,
    isSavingUser,
  };
}
