import { useQuery } from '@tanstack/react-query';

type UseTradingPermissionsQueryOptions = {
  userId?: string;
};

export function useTradingPermissionsQuery({
  userId,
}: UseTradingPermissionsQueryOptions) {
  const { data: permissionsData, isLoading: isPermissionsLoading } = useQuery<{ permissions: string[] }>({
    queryKey: ['/api/auth/rbac/permissions'],
    enabled: Boolean(userId),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  return {
    isPermissionsLoading,
    permissionsData,
  };
}
