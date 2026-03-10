import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { CustomRoleItem, PermissionItem, Role, RolePermissionItem } from '@/pages/users-admin/types';

type PermissionToast = (options: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

type CustomRolePermissionRecord = {
  id: string;
  permissionId: string;
  permission: PermissionItem;
};

type UseRolePermissionOrchestrationParams = {
  customRolePermissionsData?: { rolePermissions: CustomRolePermissionRecord[] };
  rolePermissionsData?: { rolePermissions: RolePermissionItem[] };
  selectedCustomRole: CustomRoleItem | null;
  selectedRole: Role;
  t: TFunction;
  toast: PermissionToast;
};

export function useRolePermissionOrchestration({
  customRolePermissionsData,
  rolePermissionsData,
  selectedCustomRole,
  selectedRole,
  t,
  toast,
}: UseRolePermissionOrchestrationParams) {
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

  const [rolePermissionCodes, setRolePermissionCodes] = useState<Set<string>>(new Set());
  const rolePermissionCodesRef = useRef<Set<string>>(new Set());
  const rolePermissionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rolePermissionSaveQueueRef = useRef(Promise.resolve());
  const isLockedRole = selectedRole === 'admin' || selectedRole === 'super_admin';

  const [customRolePermissionCodes, setCustomRolePermissionCodes] = useState<Set<string>>(new Set());
  const customRolePermissionCodesRef = useRef<Set<string>>(new Set());
  const customRolePermissionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customRolePermissionSaveQueueRef = useRef(Promise.resolve());
  const lastCustomRoleIdRef = useRef<string | null>(null);

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

  const flushCustomRolePermissionSave = (roleId?: string | null) => {
    const targetRoleId = roleId ?? lastCustomRoleIdRef.current;
    if (!customRolePermissionSaveTimerRef.current) {
      return;
    }
    clearTimeout(customRolePermissionSaveTimerRef.current);
    customRolePermissionSaveTimerRef.current = null;
    if (!targetRoleId) {
      return;
    }
    enqueueCustomRolePermissionSave(targetRoleId, Array.from(customRolePermissionCodesRef.current));
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
    const currentRoleId = selectedCustomRole?.id ?? null;
    lastCustomRoleIdRef.current = currentRoleId;
    customRolePermissionSaveQueueRef.current = Promise.resolve();
    if (customRolePermissionSaveTimerRef.current) {
      clearTimeout(customRolePermissionSaveTimerRef.current);
      customRolePermissionSaveTimerRef.current = null;
    }
    return () => {
      flushCustomRolePermissionSave(currentRoleId);
    };
  }, [selectedCustomRole?.id]);

  const handleRolePermissionToggle = (permissionCode: string, checked: boolean) => {
    if (isLockedRole) {
      return;
    }
    setRolePermissionCodes((currentCodes) => {
      const nextCodes = new Set(currentCodes);
      if (checked) {
        nextCodes.add(permissionCode);
      } else {
        nextCodes.delete(permissionCode);
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
  };

  const handleCustomRolePermissionToggle = (permissionCode: string, checked: boolean) => {
    if (!selectedCustomRole) return;
    setCustomRolePermissionCodes((currentCodes) => {
      const nextCodes = new Set(currentCodes);
      if (checked) {
        nextCodes.add(permissionCode);
      } else {
        nextCodes.delete(permissionCode);
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
  };

  return {
    customRolePermissionCodes,
    flushCustomRolePermissionSave,
    handleCustomRolePermissionToggle,
    handleRolePermissionToggle,
    isLockedRole,
    rolePermissionCodes,
  };
}
