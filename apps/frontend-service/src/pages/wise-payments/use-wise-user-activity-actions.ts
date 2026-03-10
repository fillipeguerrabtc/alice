import { useMutation } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';

type NotifyFn = (params: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;

type WiseActivityFilters = {
  monetaryResourceType: string;
  profileId: string;
  since: string;
  size: string;
  status: string;
  until: string;
};

type UseWiseUserActivityActionsOptions = {
  notify: NotifyFn;
  t: TFunction;
};

type UseWiseUserActivityActionsResult = {
  activityFilters: WiseActivityFilters;
  activityResults: string | null;
  handleActivityFilterChange: (field: keyof WiseActivityFilters, value: string) => void;
  handleFetchWiseUser: () => void;
  handleListActivities: () => void;
  setActivityFilters: Dispatch<SetStateAction<WiseActivityFilters>>;
  setWiseUserId: (value: string) => void;
  wiseUserId: string;
  wiseUserResult: string | null;
};

const INITIAL_ACTIVITY_FILTERS: WiseActivityFilters = {
  monetaryResourceType: '',
  profileId: '',
  since: '',
  size: '',
  status: '',
  until: '',
};

export function useWiseUserActivityActions(options: UseWiseUserActivityActionsOptions): UseWiseUserActivityActionsResult {
  const { notify, t } = options;
  const [wiseUserId, setWiseUserId] = useState('');
  const [wiseUserResult, setWiseUserResult] = useState<string | null>(null);
  const [activityFilters, setActivityFilters] = useState<WiseActivityFilters>(INITIAL_ACTIVITY_FILTERS);
  const [activityResults, setActivityResults] = useState<string | null>(null);

  const getWiseUserByIdMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest('GET', `/api/integrations/wise/users/${encodeURIComponent(id)}`);
      return response.json() as Promise<{ user: Record<string, unknown> }>;
    },
    onSuccess: (data) => {
      setWiseUserResult(JSON.stringify(data.user, null, 2));
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const listActivitiesMutation = useMutation({
    mutationFn: async (filters: WiseActivityFilters) => {
      const params = new URLSearchParams();
      if (filters.profileId) params.set('profileId', filters.profileId);
      if (filters.monetaryResourceType) params.set('monetaryResourceType', filters.monetaryResourceType);
      if (filters.status) params.set('status', filters.status);
      if (filters.since) params.set('since', filters.since);
      if (filters.until) params.set('until', filters.until);
      if (filters.size) params.set('size', filters.size);
      const query = params.toString();
      const response = await apiRequest('GET', `/api/integrations/wise/activities${query ? `?${query}` : ''}`);
      return response.json() as Promise<{ activities: Array<Record<string, unknown>> }>;
    },
    onSuccess: (data) => {
      setActivityResults(JSON.stringify(data.activities, null, 2));
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const handleFetchWiseUser = useCallback(() => {
    if (!wiseUserId.trim()) {
      notify({ title: t('wise.users.missingId'), variant: 'destructive' });
      return;
    }
    getWiseUserByIdMutation.mutate(wiseUserId.trim());
  }, [getWiseUserByIdMutation, notify, t, wiseUserId]);

  const handleListActivities = useCallback(() => {
    listActivitiesMutation.mutate(activityFilters);
  }, [activityFilters, listActivitiesMutation]);

  const handleActivityFilterChange = useCallback((field: keyof WiseActivityFilters, value: string) => {
    setActivityFilters((previous) => ({ ...previous, [field]: value }));
  }, []);

  return {
    activityFilters,
    activityResults,
    handleActivityFilterChange,
    handleFetchWiseUser,
    handleListActivities,
    setActivityFilters,
    setWiseUserId,
    wiseUserId,
    wiseUserResult,
  };
}
