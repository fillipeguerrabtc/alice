import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchWiseProfileScopedJson } from './wise-query-builders';

type WiseQueryKeyPart = string | number;

type UseWiseApiQueryOptions = {
  endpoint: string;
  enabled: boolean;
};

type UseWiseProfileScopedQueryOptions = {
  endpoint: string;
  profileFilter: string;
  enabled: boolean;
  queryKeyParts?: WiseQueryKeyPart[];
  queryParams?: Record<string, string>;
};

export function useWiseApiQuery<TResponse>(
  options: UseWiseApiQueryOptions
): UseQueryResult<TResponse, Error> {
  const { endpoint, enabled } = options;

  return useQuery<TResponse, Error>({
    queryKey: [endpoint],
    enabled,
  });
}

export function useWiseProfileScopedQuery<TResponse>(
  options: UseWiseProfileScopedQueryOptions
): UseQueryResult<TResponse, Error> {
  const {
    endpoint,
    profileFilter,
    enabled,
    queryKeyParts = [],
    queryParams,
  } = options;

  return useQuery<TResponse, Error>({
    queryKey: [endpoint, profileFilter, ...queryKeyParts],
    enabled,
    queryFn: async () =>
      fetchWiseProfileScopedJson<TResponse>(
        endpoint,
        profileFilter,
        queryParams
      ),
  });
}
