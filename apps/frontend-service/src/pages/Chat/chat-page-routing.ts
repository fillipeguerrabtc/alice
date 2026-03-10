export type ChatWorkspaceKey = 'all' | 'conversation' | 'operations' | 'governance' | 'diagnostics';

export const CHAT_WORKSPACES: Array<{ value: ChatWorkspaceKey; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'conversation', label: 'Conversa' },
  { value: 'operations', label: 'Operações' },
  { value: 'governance', label: 'Governança' },
  { value: 'diagnostics', label: 'Diagnóstico' },
];

const ROUTE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTE_NUMERIC_ID_PATTERN = /^\d+$/;
const ROUTE_HEX_HASH_PATTERN = /^[0-9a-f]{24,}$/i;

export function normalizeRouteForContext(pathname: string): string {
  if (!pathname) return '/chat';
  const base = pathname.split('?')[0].split('#')[0];
  if (/^\/chat(\/|$)/.test(base) || /^\/conversations(\/|$)/.test(base)) return '/chat';
  if (/^\/trading(\/|$)/.test(base)) return '/trading';
  if (/^\/demo-trading(\/|$)/.test(base)) return '/demo-trading';

  const segments = base.split('/').filter(Boolean);
  const filtered = segments.filter(
    (seg) => !ROUTE_UUID_PATTERN.test(seg) &&
             !ROUTE_NUMERIC_ID_PATTERN.test(seg) &&
             !ROUTE_HEX_HASH_PATTERN.test(seg)
  );
  return filtered.length > 0 ? `/${filtered.join('/')}` : '/chat';
}

const ISO_DATE_QUERY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDateQueryParam(value: string | null | undefined): value is string {
  return typeof value === 'string' && ISO_DATE_QUERY_PATTERN.test(value);
}
