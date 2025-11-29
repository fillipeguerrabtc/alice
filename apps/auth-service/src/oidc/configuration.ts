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

import type { Configuration, ClientMetadata, KoaContextWithOIDC } from 'oidc-provider';
import { createAdapter } from './adapter.js';
import { getJWKS } from './jwks.js';
import { getDatabase } from '@alice/database';
import { users, oauthClients, userModules, systemModules } from '@alice/shared/schema';
import { eq, and } from 'drizzle-orm';
import { createLogger } from '@alice/logger';

const logger = createLogger('oidc-config');

// URL base do OIDC Provider
// Produção: OIDC_ISSUER definido via variável de ambiente
// Desenvolvimento: usa APP_BASE_URL ou default localhost
const ISSUER_URL = process.env.OIDC_ISSUER 
  || process.env.APP_BASE_URL 
  || (process.env.NODE_ENV === 'production' 
    ? 'https://auth.alice.yesyoudeserve.duckdns.org' 
    : 'http://localhost:3001');

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

    // Buscar módulos do usuário
    const userModulesData = await db.select({
      moduleCode: systemModules.codigo,
      moduleName: systemModules.nome,
    })
      .from(userModules)
      .innerJoin(systemModules, eq(userModules.moduleId, systemModules.id))
      .where(and(
        eq(userModules.userId, id),
        eq(userModules.permitido, true)
      ));

    const modules = userModulesData.map(m => m.moduleCode);

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
          baseClaims.zoneinfo = user.timezone || 'Europe/Lisbon';
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
          baseClaims.modules = modules;
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
  const cookieKeys = process.env.OIDC_COOKIE_KEYS
    ? process.env.OIDC_COOKIE_KEYS.split(',')
    : ['alice-oidc-secret-key-1', 'alice-oidc-secret-key-2'];

  const configuration: Configuration = {
    // =========================================================================
    // ADAPTER: PostgreSQL (Regra 6 - sem in-memory)
    // =========================================================================
    adapter: createAdapter,

    // =========================================================================
    // CLIENTES REGISTRADOS (100% do banco - Regra 6)
    // Os clientes grafana-sso e erpnext-sso são carregados via getRegisteredClients()
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
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
      },
      short: {
        signed: true,
        secure: process.env.NODE_ENV === 'production',
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
      alice: ['role', 'tenant_id', 'tenant_name', 'modules', 'auth_provider'],
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
