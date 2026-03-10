import { apiRequest } from '@/lib/queryClient';

type WiseQueryValue = string | number | boolean;

type WiseQueryParams = Record<string, WiseQueryValue | null | undefined>;

function appendWiseQueryParams(searchParams: URLSearchParams, params: WiseQueryParams) {
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    searchParams.set(key, String(value));
  });
}

export function buildWiseProfileScopedPath(
  path: string,
  profileId: string,
  extraParams: WiseQueryParams = {}
) {
  const searchParams = new URLSearchParams();
  searchParams.set('profileId', profileId);
  appendWiseQueryParams(searchParams, extraParams);
  return `${path}?${searchParams.toString()}`;
}

export async function fetchWiseProfileScopedJson<TResponse>(
  path: string,
  profileId: string,
  extraParams: WiseQueryParams = {}
): Promise<TResponse> {
  const response = await apiRequest(
    'GET',
    buildWiseProfileScopedPath(path, profileId, extraParams)
  );
  return response.json() as Promise<TResponse>;
}
