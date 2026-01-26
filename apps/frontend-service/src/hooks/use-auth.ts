import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest, getQueryFn, setCsrfToken } from '@/lib/queryClient';

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  preferredName?: string | null;
  idioma?: string | null;
  timezone?: string | null;
  preferencias?: {
    location?: {
      countryCode?: string | null;
      countryName?: string | null;
      region?: string | null;
      city?: string | null;
    } | null;
  } | null;
  role: string;
  roles?: string[];
  tenantId?: string;
}

interface AuthResponse {
  user: User;
  csrfToken?: string;
}

export function useAuth() {
  const { data, isLoading, error } = useQuery<AuthResponse | null>({
    queryKey: ['/api/auth/user'],
    queryFn: getQueryFn({ on401: 'returnNull' }),
    staleTime: 1000 * 60 * 5,
  });

  // Armazenar CSRF token quando recebido (Regra 16 - Segurança Enterprise)
  if (data?.csrfToken) {
    setCsrfToken(data.csrfToken);
  }

  const user = data?.user || null;

  const loginMutation = useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      const res = await apiRequest('POST', '/api/auth/login', credentials);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('POST', '/api/auth/logout');
    },
    onSuccess: () => {
      setCsrfToken(''); // Limpar CSRF token no logout
      queryClient.setQueryData(['/api/auth/user'], null);
      queryClient.clear();
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    error,
    login: loginMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    isLoginPending: loginMutation.isPending,
    isLogoutPending: logoutMutation.isPending,
  };
}
