/**
 * Configuração central de mapeamento Rota → Contexto
 * Plano Enterprise - Agentes Especializados por Namespace
 *
 * Derivação automática das rotas do App (App.tsx) para contexto semântico.
 * Usado pelo LLM Gateway e namespace-context-resolver para resolver
 * namespace/agente a partir da rota de origem.
 *
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * Autor: Fillipe Guerra
 * Data: 11 de Fevereiro de 2026
 */

/** Mapeamento rota (pathname) → contexto semântico */
export const ROUTE_TO_CONTEXT: Record<string, string> = {
  '/': 'default',
  '/chat': 'default',
  '/chat/:conversationId': 'default',
  '/conversations': 'default',
  '/agents': 'agents',
  '/takeover': 'trading',
  '/images': 'images',
  '/namespaces': 'namespaces',
  '/documents': 'documents',
  '/training': 'training',
  '/integrations': 'integrations',
  '/wise': 'wise',
  '/trading': 'trading',
  '/demo-trading': 'trading',
  '/users': 'users',
  '/observability': 'observability',
  '/alice-config': 'alice-config',
  '/agentic-config': 'agentic-config',
  '/profile': 'profile',
  '/settings': 'profile',
  '/system-settings': 'system-settings',
};

/** Rotas do App (ordem de match: mais específica primeiro) */
export const APP_ROUTES = [
  '/chat/:conversationId',
  '/chat',
  '/conversations',
  '/agents',
  '/takeover',
  '/images',
  '/namespaces',
  '/documents',
  '/training',
  '/integrations',
  '/wise',
  '/trading',
  '/demo-trading',
  '/users',
  '/observability',
  '/alice-config',
  '/agentic-config',
  '/profile',
  '/settings',
  '/system-settings',
  '/',
] as const;

/**
 * Converte pathname em contexto semântico.
 * Match exato primeiro; fallback para prefixo mais longo.
 */
export function pathnameToContext(pathname: string): string {
  const normalized = pathname === '' ? '/' : pathname.startsWith('/') ? pathname : `/${pathname}`;
  // Match exato
  if (ROUTE_TO_CONTEXT[normalized] !== undefined) {
    return ROUTE_TO_CONTEXT[normalized];
  }
  // Match por prefixo (ex: /chat/abc123 → default)
  const segments = normalized.split('/').filter(Boolean);
  for (let i = segments.length; i >= 1; i--) {
    const prefix = '/' + segments.slice(0, i).join('/');
    if (ROUTE_TO_CONTEXT[prefix] !== undefined) {
      return ROUTE_TO_CONTEXT[prefix];
    }
  }
  return 'default';
}
