/**
 * Namespace Context Resolver - Alice Enterprise Platform
 *
 * Reconhecimento automático de namespace/agente a partir do contexto (rota, domínio, feature).
 * Mapeamento dinâmico via ROUTE_TO_CONTEXT e contextoSistema (JSON) nos namespaces.
 *
 * Plano Enterprise - Agentes Especializados por Namespace
 *
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * Autor: Fillipe Guerra
 * Data: 11 de Fevereiro de 2026
 */

import { pathnameToContext } from './route-context-config.js';

/** Contextos semânticos reconhecidos - string livre para compatibilidade */
export type NamespaceContext = string;

/** Estrutura JSON de contextoSistema (rotas e temas associados ao namespace) */
export interface ContextoSistemaJson {
  routes?: string[];
  themes?: string[];
}

/** Resultado da resolução de namespace por contexto */
export interface ResolvedNamespaceContext {
  namespaceId: string | null;
  agentId: string | null;
  slug: string | null;
  context: string;
}

/** Getters para buscar dados do banco (abstração para testabilidade) */
export interface NamespaceResolverGetters {
  getNamespaceBySlug: (
    tenantId: string,
    slug: string
  ) => Promise<{ id: string; tenantId: string | null; contextoSistema?: string | null } | null | undefined>;
  getNamespacesByTenant?: (
    tenantId: string
  ) => Promise<Array<{ id: string; slug: string; contextoSistema?: string | null }>>;
  getActiveAgentByNamespace?: (namespaceId: string) => Promise<{ id: string } | null | undefined>;
}

/**
 * Parseia contextoSistema (JSON) do namespace.
 * Formato: {"routes": ["/trading", "/demo-trading"], "themes": ["trading", "btc"]}
 */
function parseContextoSistema(raw: string | null | undefined): ContextoSistemaJson | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ContextoSistemaJson;
    }
  } catch {
    // Ignorar JSON inválido
  }
  return null;
}

/**
 * Verifica se o contextoSistema do namespace cobre a rota ou o contexto.
 */
function contextoSistemaMatches(
  contextoSistema: string | null | undefined,
  route: string,
  context: string
): boolean {
  const parsed = parseContextoSistema(contextoSistema);
  if (!parsed) return false;
  const routes = parsed.routes ?? [];
  const themes = parsed.themes ?? [];
  const routeNormalized = route.startsWith('/') ? route : `/${route}`;
  return (
    routes.some((r) => r === routeNormalized || routeNormalized.startsWith(r + '/')) ||
    themes.includes(context)
  );
}

/**
 * Resolve namespace e agente a partir da ROTA (pathname).
 * Busca namespace onde slug ou contextoSistema cobre a rota.
 *
 * @param tenantId - Tenant do usuário
 * @param route - Rota/pathname (ex: /trading, /chat/abc123)
 * @param getters - Funções para buscar namespaces e agentes
 */
export async function resolveNamespaceByRoute(
  tenantId: string,
  route: string,
  getters: NamespaceResolverGetters
): Promise<ResolvedNamespaceContext> {
  const context = pathnameToContext(route);

  // 1. Buscar por slug exato (contexto = slug)
  const nsBySlug = await getters.getNamespaceBySlug(tenantId, context);
  if (nsBySlug) {
    let agentId: string | null = null;
    if (getters.getActiveAgentByNamespace) {
      const agent = await getters.getActiveAgentByNamespace(nsBySlug.id);
      if (agent) agentId = agent.id;
    }
    return {
      namespaceId: nsBySlug.id,
      agentId,
      slug: context,
      context,
    };
  }

  // 2. Buscar por contextoSistema (rotas/temas)
  if (getters.getNamespacesByTenant) {
    const allNs = await getters.getNamespacesByTenant(tenantId);
    const matched = allNs.find((ns) => contextoSistemaMatches(ns.contextoSistema, route, context));
    if (matched) {
      let agentId: string | null = null;
      if (getters.getActiveAgentByNamespace) {
        const agent = await getters.getActiveAgentByNamespace(matched.id);
        if (agent) agentId = agent.id;
      }
      return {
        namespaceId: matched.id,
        agentId,
        slug: matched.slug,
        context,
      };
    }
  }

  return { namespaceId: null, agentId: null, slug: null, context };
}

/**
 * Resolve namespace e agente a partir de um contexto semântico (string).
 *
 * Usado quando o frontend envia context (ex: da rota /trading) sem namespaceId/agentId explícitos.
 * Mantido para compatibilidade com resolveNamespaceByContext anterior.
 *
 * @param tenantId - Tenant do usuário
 * @param context - Contexto semântico (trading, sales, support, cambio, default, etc.)
 * @param getters - Funções para buscar namespace por slug e agente por namespace
 */
export async function resolveNamespaceByContext(
  tenantId: string,
  context: NamespaceContext,
  getters: {
    getNamespaceBySlug: (
      tenantId: string,
      slug: string
    ) => Promise<{ id: string; tenantId: string | null } | null | undefined>;
    getActiveAgentByNamespace?: (namespaceId: string) => Promise<{ id: string } | null | undefined>;
  }
): Promise<ResolvedNamespaceContext> {
  const slug = context === 'default' ? null : context;
  if (!slug) {
    return { namespaceId: null, agentId: null, slug: null, context };
  }

  const namespace = await getters.getNamespaceBySlug(tenantId, slug);
  if (!namespace) {
    return { namespaceId: null, agentId: null, slug, context };
  }

  let agentId: string | null = null;
  if (getters.getActiveAgentByNamespace) {
    const agent = await getters.getActiveAgentByNamespace(namespace.id);
    if (agent) agentId = agent.id;
  }

  return {
    namespaceId: namespace.id,
    agentId,
    slug,
    context,
  };
}
