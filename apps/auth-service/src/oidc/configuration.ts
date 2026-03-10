/**
 * OIDC Provider Configuration - Alice Enterprise Platform
 * Configuração completa do node-oidc-provider v9.5.2
 * 
 * Seguindo Best Practices 2025:
 * - PKCE obrigatório (Tarefa 41)
 * - RS256 JWT signing (Tarefa 42)
 * - PostgreSQL adapter (Regra 6 - sem in-memory)
 * 
 * @author Alice Team
 * @version 1.0.0
 */

import type {
  Configuration,
  ClientMetadata,
  KoaContextWithOIDC,
  AccessToken,
  ClientCredentials,
  UnknownObject,
} from 'oidc-provider';
import { createAdapter } from './adapter.js';
import { getJWKS } from './jwks.js';
import { getDatabase } from '@alice/database';
import { users, oauthClients } from '@alice/shared/schema';
import { eq } from '@alice/database';
import { createLogger } from '@alice/logger';
import { getNodeEnv, readOptionalStringEnv } from '@alice/config';

const logger = createLogger('oidc-config');
const nodeEnv = getNodeEnv();
const OIDC_API_AUDIENCE = readOptionalStringEnv('OIDC_API_AUDIENCE');

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function resolveOidcIssuerUrl(): string {
  const configuredIssuer = readOptionalStringEnv('OIDC_ISSUER') ?? readOptionalStringEnv('APP_BASE_URL');

  if (configuredIssuer) {
    try {
      const parsed = new URL(configuredIssuer);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('protocolo inválido');
      }
      return normalizeUrl(parsed.toString());
    } catch (error) {
      throw new Error(`OIDC_ISSUER/APP_BASE_URL inválido: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (nodeEnv === 'production') {
    throw new Error('OIDC_ISSUER ou APP_BASE_URL são obrigatórios em produção (Regra 6 - fail-fast)');
  }

  return 'http://localhost:3001';
}

// URL base do OIDC Provider
// Produção: OIDC_ISSUER/APP_BASE_URL obrigatórios
// Desenvolvimento: fallback local explícito
const ISSUER_URL = resolveOidcIssuerUrl();

/**
 * Buscar conta de usuário para OIDC
 * Retorna Account compatível com oidc-provider
 */
async function findAccountById(id: string) {
  const db = getDatabase();

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
      with: {
        tenant: true,
      },
    });

    if (!user) {
      logger.warn({ userId: id }, 'Usuário não encontrado para OIDC');
      return undefined;
    }

    return {
      accountId: id,
      async claims(use: string, scope: string) {
        // Claims básicos (sempre retornados)
        const baseClaims: { sub: string; [key: string]: unknown } = {
          sub: id,
        };

        // Scope: profile
        if (scope.includes('profile') || use === 'id_token') {
          baseClaims.name = [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined;
          baseClaims.given_name = user.firstName || undefined;
          baseClaims.family_name = user.lastName || undefined;
          baseClaims.picture = user.profileImageUrl || undefined;
          baseClaims.locale = user.idioma || 'pt-BR';
          baseClaims.zoneinfo = user.timezone || 'America/Sao_Paulo';
          baseClaims.updated_at = user.updatedAt ? Math.floor(user.updatedAt.getTime() / 1000) : undefined;
        }

        // Scope: email
        if (scope.includes('email')) {
          baseClaims.email = user.email;
          baseClaims.email_verified = user.emailVerified;
        }

        // Scope: alice (claims customizados da plataforma)
        if (scope.includes('alice')) {
          baseClaims.role = user.role;
          baseClaims.tenant_id = user.tenantId;
          baseClaims.tenant_name = (user as { tenant?: { nome?: string } }).tenant?.nome;
          baseClaims.auth_provider = user.authProvider;
        }

        return baseClaims;
      },
    };
  } catch (error) {
    logger.error({ error, userId: id }, 'Erro ao buscar conta para OIDC');
    return undefined;
  }
}

/**
 * Buscar clientes OAuth registrados no banco
 */
async function getRegisteredClients(): Promise<ClientMetadata[]> {
  const db = getDatabase();

  try {
    const clients = await db.select()
      .from(oauthClients)
      .where(eq(oauthClients.ativo, true));

    return clients.map((client) => ({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      client_name: client.nome,
      redirect_uris: client.redirectUris || [],
      response_types: ['code'],
      grant_types: client.grantTypes || ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: (client.tokenEndpointAuthMethod || 'client_secret_post') as 'client_secret_post' | 'client_secret_basic' | 'none',
      scope: (client.scopes || ['openid', 'profile', 'email']).join(' '),
      // Configuração de TTL
      default_acr_values: [],
    }));
  } catch (error) {
    logger.error({ error }, 'Erro ao carregar clientes OAuth do banco');
    return [];
  }
}

/**
 * Criar configuração OIDC
 */
export async function createOIDCConfiguration(): Promise<Configuration> {
  const jwks = await getJWKS();
  const registeredClients = await getRegisteredClients();

  // Cookie keys para segurança (produção deve usar variáveis de ambiente)
  const rawCookieKeys = readOptionalStringEnv('OIDC_COOKIE_KEYS');
  const cookieKeys = rawCookieKeys
    ? rawCookieKeys.split(',').map((value) => value.trim()).filter(Boolean)
    : ['alice-oidc-secret-key-1', 'alice-oidc-secret-key-2'];

  // FAIL-FAST em produção (Regra 6): sem defaults inseguros para chaves de cookie
  if (nodeEnv === 'production' && !rawCookieKeys) {
    const message = 'CRITICAL: OIDC_COOKIE_KEYS é OBRIGATÓRIO em produção (valores múltiplos separados por vírgula).';
    logger.error(message);
    throw new Error(message);
  }

  const configuration: Configuration = {
    // =========================================================================
    // ADAPTER: PostgreSQL (Regra 6 - sem in-memory)
    // =========================================================================
    adapter: createAdapter,

    // =========================================================================
    // CLIENTES REGISTRADOS (100% do banco - Regra 6)
    // Os clientes grafana-sso são carregados via getRegisteredClients()
    // =========================================================================
    clients: registeredClients,

    // =========================================================================
    // JWKS: Chaves para assinatura de tokens (Tarefa 42 - RS256)
    // =========================================================================
    jwks,

    // =========================================================================
    // COOKIE: Configuração segura
    // =========================================================================
    cookies: {
      keys: cookieKeys,
      long: {
        signed: true,
        secure: nodeEnv === 'production',
        sameSite: 'lax' as const,
      },
      short: {
        signed: true,
        secure: nodeEnv === 'production',
        sameSite: 'lax' as const,
      },
    },

    // =========================================================================
    // TTL: Tempo de vida dos tokens
    // =========================================================================
    ttl: {
      AccessToken: 3600, // 1 hora
      AuthorizationCode: 600, // 10 minutos
      IdToken: 3600, // 1 hora
      RefreshToken: 14 * 24 * 60 * 60, // 14 dias
      Interaction: 3600, // 1 hora
      Session: 14 * 24 * 60 * 60, // 14 dias
      Grant: 14 * 24 * 60 * 60, // 14 dias
    },

    // =========================================================================
    // ACCOUNT: Busca de contas
    // =========================================================================
    findAccount: async (_ctx, id) => findAccountById(id),

    // =========================================================================
    // CLAIMS: Scopes e claims suportados
    // =========================================================================
    claims: {
      openid: ['sub'],
      profile: ['name', 'given_name', 'family_name', 'picture', 'locale', 'zoneinfo', 'updated_at'],
      email: ['email', 'email_verified'],
      alice: ['role', 'tenant_id', 'tenant_name', 'auth_provider'],
    },

    // =========================================================================
    // TOKEN CLAIMS (WS4): incluir claims customizados quando scope "alice"
    // =========================================================================
    // oidc-provider v9 expõe `extraTokenClaims` (não específico por tipo).
    // Nós aplicamos apenas quando o token é AccessToken (ou equivalente) e o scope inclui "alice".
    extraTokenClaims: async (ctx: KoaContextWithOIDC, token: AccessToken | ClientCredentials): Promise<UnknownObject | undefined> => {
      try {
        const scope = typeof ctx.oidc.params?.scope === 'string' ? ctx.oidc.params.scope : '';
        const wantsAliceClaims = scope.split(/\s+/).includes('alice');
        if (!wantsAliceClaims) return {};

        // `accountId` existe em tokens associados a usuário (fluxo authorization_code).
        const accountId = 'accountId' in token ? (token as AccessToken & { accountId?: string }).accountId : undefined;
        if (!accountId) return {};

        const account = await findAccountById(accountId);
        if (!account) return {};

        const aliceClaims = await account.claims('access_token', scope);
        // Remover sub (já existe) e retornar apenas extras relevantes
        const { sub: _sub, ...rest } = aliceClaims as Record<string, unknown>;
        return { ...rest };
      } catch (error) {
        logger.error({ error }, 'Falha ao montar extraAccessTokenClaims');
        return {};
      }
    },

    // =========================================================================
    // FEATURES: Funcionalidades habilitadas
    // =========================================================================
    features: {
      // Desabilitar UI de desenvolvimento (usamos nossa própria)
      devInteractions: { enabled: false },

      // Habilitar revogação de tokens
      revocation: { enabled: true },

      // Habilitar introspecção de tokens
      introspection: { enabled: true },

      // Habilitar userinfo
      userinfo: { enabled: true },

      // Habilitar logout iniciado pelo RP
      rpInitiatedLogout: { enabled: true },

      // Habilitar backchannel logout
      backchannelLogout: { enabled: true },

      // PKCE: Obrigatório para todos os clientes (Tarefa 41)
      // Best practice 2025: PKCE é obrigatório mesmo para clientes confidenciais

      // =========================================================================
      // JWT Access Tokens (WS4): Resource Indicators (RFC 8707)
      // =========================================================================
      // Objetivo: Emitir Access Tokens em formato JWT com `aud` (audience) definido,
      // para validação local via JWKS nos microsserviços (sem introspection).
      //
      // NOTA: Em oidc-provider v9, JWT Access Tokens requerem audience.
      // REF: docs oficiais do node-oidc-provider (panva) / RFC 8707.
      resourceIndicators: {
        enabled: true,
        defaultResource: (_ctx, _client, oneOf) => {
          // Se o client não enviar `resource=`, usamos audience padrão.
          // IMPORTANTE: a assinatura exige retornar string/string[] (sem undefined).
          if (OIDC_API_AUDIENCE) return OIDC_API_AUDIENCE;
          if (Array.isArray(oneOf) && oneOf.length > 0) return oneOf[0];
          // Fallback determinístico (dev/test). Em produção, recomenda-se setar OIDC_API_AUDIENCE.
          return 'alice-api';
        },
        getResourceServerInfo: (_ctx, resourceIndicator) => {
          // Audience para o Resource Server (microsserviços Alice)
          const audience = OIDC_API_AUDIENCE || resourceIndicator;

          return {
            audience,
            // Escopos permitidos para este resource (inclui scope customizado "alice")
            scope: 'openid profile email alice offline_access',
            accessTokenTTL: 3600,
            accessTokenFormat: 'jwt',
            jwt: { sign: { alg: 'RS256' } },
          };
        },
        useGrantedResource: () => true,
      },
    },

    // =========================================================================
    // PKCE: Configuração (Tarefa 41)
    // =========================================================================
    pkce: {
      required: () => true, // Obrigatório para TODOS os clientes - Best practice 2025
    },

    // =========================================================================
    // SCOPES: Scopes suportados
    // =========================================================================
    scopes: ['openid', 'profile', 'email', 'offline_access', 'alice'],

    // =========================================================================
    // RESPONSE TYPES: Tipos de resposta suportados
    // =========================================================================
    responseTypes: ['code'],

    // =========================================================================
    // SUBJECT TYPES: Tipos de subject suportados
    // =========================================================================
    subjectTypes: ['public'],

    // =========================================================================
    // INTERACTIONS: URL para interações (login/consent)
    // =========================================================================
    interactions: {
      url(ctx, interaction) {
        // Redirecionar para página de login da Alice
        return `/auth/interaction/${interaction.uid}`;
      },
    },

    // =========================================================================
    // RENDER ERROR: Personalização de erros
    // =========================================================================
    renderError: async (ctx, out, error) => {
      logger.error({ error, out }, 'Erro OIDC');
      ctx.type = 'html';
      ctx.body = `<!DOCTYPE html>
        <html>
        <head>
          <title>Erro - Alice SSO</title>
          <style>
            body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; }
            .error { background: #fee; border: 1px solid #c00; padding: 20px; border-radius: 8px; }
            a { color: #0066cc; }
          </style>
        </head>
        <body>
          <h1>Erro de Autenticação</h1>
          <div class="error">
            <p><strong>Erro:</strong> ${out.error}</p>
            <p>${out.error_description || 'Ocorreu um erro durante a autenticação.'}</p>
          </div>
          <p><a href="/">Voltar para o início</a></p>
        </body>
        </html>`;
    },

    // =========================================================================
    // EXTRA PARAMS: Parâmetros extras permitidos
    // =========================================================================
    extraParams: ['tenant_id'],

    // =========================================================================
    // CONFORMIDADE: OpenID Connect
    // =========================================================================
    conformIdTokenClaims: true,
  };

  return configuration;
}

/**
 * Obter URL do issuer
 */
export function getIssuerUrl(): string {
  return ISSUER_URL;
}

export { ISSUER_URL };

