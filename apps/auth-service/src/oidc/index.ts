/**
 * OIDC Provider Integration - Alice Enterprise Platform
 * Integração do node-oidc-provider com Express
 * 
 * Endpoints implementados (Tarefas 1-5):
 * - /.well-known/openid-configuration (Tarefa 1)
 * - /oauth/authorize (Tarefa 2)
 * - /oauth/token (Tarefa 3)
 * - /oauth/userinfo (Tarefa 4)
 * - /oauth/revoke (Tarefa 5)
 * 
 * @author Alice Team
 * @version 1.0.0
 */

import Provider from 'oidc-provider';
import type { Express, Request, Response } from 'express';
import { createOIDCConfiguration, getIssuerUrl } from './configuration.js';
import { getPublicJWKS } from './jwks.js';
import { createLogger } from '@alice/logger';

const logger = createLogger('oidc-provider');

// Instância do OIDC Provider (singleton)
let oidcProvider: Provider | null = null;

/**
 * Inicializar OIDC Provider
 */
export async function initializeOIDCProvider(): Promise<Provider> {
  if (oidcProvider) {
    return oidcProvider;
  }

  const issuer = getIssuerUrl();
  const configuration = await createOIDCConfiguration();

  oidcProvider = new Provider(issuer, configuration);

  // Configurar eventos de logging
  oidcProvider.on('authorization.error', (ctx, error) => {
    logger.error({ error, path: ctx.path }, 'Erro de autorização OIDC');
  });

  oidcProvider.on('grant.error', (ctx, error) => {
    logger.error({ error, path: ctx.path }, 'Erro de grant OIDC');
  });

  oidcProvider.on('introspection.error', (ctx, error) => {
    logger.error({ error, path: ctx.path }, 'Erro de introspecção OIDC');
  });

  oidcProvider.on('revocation.error', (ctx, error) => {
    logger.error({ error, path: ctx.path }, 'Erro de revogação OIDC');
  });

  oidcProvider.on('server_error', (ctx, error) => {
    logger.error({ error, path: ctx.path }, 'Erro interno OIDC');
  });

  // Eventos de sucesso (debug level)
  oidcProvider.on('authorization.success', (ctx) => {
    logger.debug({ path: ctx.path }, 'Autorização OIDC bem-sucedida');
  });

  oidcProvider.on('grant.success', (ctx) => {
    logger.debug({ path: ctx.path }, 'Grant OIDC bem-sucedido');
  });

  logger.info({ issuer }, 'OIDC Provider inicializado');

  return oidcProvider;
}

/**
 * Obter instância do OIDC Provider
 */
export function getOIDCProvider(): Provider | null {
  return oidcProvider;
}

/**
 * Montar rotas OIDC no Express
 * 
 * Rotas montadas:
 * - GET /.well-known/openid-configuration
 * - GET /.well-known/jwks.json
 * - GET /oauth/authorize
 * - POST /oauth/token
 * - GET/POST /oauth/userinfo
 * - POST /oauth/revoke
 * - POST /oauth/introspect
 * - GET /oauth/end_session (logout)
 */
export async function mountOIDCRoutes(app: Express): Promise<void> {
  const provider = await initializeOIDCProvider();

  // =========================================================================
  // DISCOVERY ENDPOINTS
  // =========================================================================

  // /.well-known/openid-configuration (Tarefa 1)
  // Rota customizada - usa mesma lógica do Provider para consistência
  app.get('/.well-known/openid-configuration', async (_req: Request, res: Response) => {
    try {
      // Usar mesma URL do Provider para garantir consistência entre issuer do token e discovery
      const issuer = getIssuerUrl();
      
      const baseConfig = {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        userinfo_endpoint: `${issuer}/oauth/userinfo`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        introspection_endpoint: `${issuer}/oauth/introspect`,
        end_session_endpoint: `${issuer}/oauth/end_session`,
        
        // Scopes suportados
        scopes_supported: ['openid', 'profile', 'email', 'offline_access', 'alice'],
        
        // Response types suportados
        response_types_supported: ['code'],
        
        // Grant types suportados
        grant_types_supported: ['authorization_code', 'refresh_token'],
        
        // Subject types suportados
        subject_types_supported: ['public'],
        
        // Algoritmos de assinatura de ID Token
        id_token_signing_alg_values_supported: ['RS256'],
        
        // Métodos de autenticação de token endpoint
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        
        // Claims suportados
        claims_supported: [
          'sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce',
          'name', 'given_name', 'family_name', 'picture', 'locale', 'zoneinfo', 'updated_at',
          'email', 'email_verified',
          'role', 'tenant_id', 'tenant_name', 'modules', 'auth_provider'
        ],
        
        // PKCE suportado (Tarefa 41)
        code_challenge_methods_supported: ['S256'],
        
        // Backchannel logout
        backchannel_logout_supported: true,
        backchannel_logout_session_supported: true,
        
        // RP-initiated logout
        frontchannel_logout_supported: true,
        frontchannel_logout_session_supported: true,
        
        // Service documentation
        service_documentation: `${issuer}/api/docs`,
        
        // UI locales
        ui_locales_supported: ['pt-BR', 'en'],
      };

      logger.debug({ issuer }, 'Discovery endpoint acessado');
      res.json(baseConfig);
    } catch (error) {
      logger.error({ error }, 'Erro ao gerar openid-configuration');
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // /.well-known/jwks.json
  app.get('/.well-known/jwks.json', async (_req: Request, res: Response) => {
    try {
      const jwks = await getPublicJWKS();
      res.json(jwks);
    } catch (error) {
      logger.error({ error }, 'Erro ao obter JWKS');
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // =========================================================================
  // OIDC PROVIDER CALLBACK (todas as rotas /oauth/*)
  // =========================================================================
  
  // Montar o provider como middleware para rotas /oauth/*
  // O oidc-provider gerencia:
  // - /oauth/authorize (Tarefa 2)
  // - /oauth/token (Tarefa 3)
  // - /oauth/userinfo (Tarefa 4)
  // - /oauth/revoke (Tarefa 5)
  // - /oauth/introspect
  // - /oauth/end_session
  
  const callback = provider.callback();
  
  app.use('/oauth', (req: Request, res: Response) => {
    // Log de requisições OIDC
    logger.debug({ 
      method: req.method, 
      path: req.path,
      clientId: req.query.client_id || req.body?.client_id,
    }, 'Requisição OIDC');
    
    // Chamar callback do provider (Koa-style - req/res only)
    return callback(req, res);
  });

  // =========================================================================
  // INTERACTION ROUTES (Login/Consent customizados)
  // =========================================================================
  
  // GET /auth/interaction/:uid - Página de interação
  app.get('/auth/interaction/:uid', async (req: Request, res: Response) => {
    try {
      const details = await provider.interactionDetails(req, res);
      const { uid, prompt, params } = details;

      logger.debug({ uid, promptName: prompt.name }, 'Interação OIDC iniciada');

      // Se já está autenticado e é só consent, auto-consentir
      if (prompt.name === 'consent' && details.session?.accountId) {
        // Auto-consent para clientes internos
        const result = {
          consent: {
            grantId: details.grantId || await provider.Grant.prototype.save.call(
              new provider.Grant({
                accountId: details.session.accountId,
                clientId: params.client_id as string,
              })
            ),
          },
        };
        
        await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: true });
        return;
      }

      // Se precisa de login, redirecionar para página de login
      if (prompt.name === 'login') {
        // Salvar UID na sessão para retornar após login
        const loginUrl = `/login?interaction=${uid}&client_id=${params.client_id}&redirect_uri=${encodeURIComponent(params.redirect_uri as string || '')}`;
        return res.redirect(loginUrl);
      }

      // Outros prompts - mostrar página de erro
      res.status(400).json({
        error: 'unsupported_prompt',
        prompt: prompt.name,
      });
    } catch (error) {
      logger.error({ error, uid: req.params.uid }, 'Erro na interação OIDC');
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /auth/interaction/:uid/login - Processar login da interação
  app.post('/auth/interaction/:uid/login', async (req: Request, res: Response) => {
    try {
      const { accountId } = req.body;
      
      if (!accountId) {
        return res.status(400).json({ error: 'account_id_required' });
      }

      const result = {
        login: {
          accountId,
          remember: true,
        },
      };

      await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
    } catch (error) {
      logger.error({ error, uid: req.params.uid }, 'Erro no login da interação OIDC');
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /auth/interaction/:uid/confirm - Confirmar consent
  app.post('/auth/interaction/:uid/confirm', async (req: Request, res: Response) => {
    try {
      const interactionDetails = await provider.interactionDetails(req, res);
      const { prompt: { name: _name, details: _details }, params, session } = interactionDetails;
      
      if (!session?.accountId) {
        return res.status(401).json({ error: 'not_authenticated' });
      }

      let grantId = interactionDetails.grantId;
      let grant: InstanceType<typeof provider.Grant>;

      if (grantId) {
        grant = await provider.Grant.find(grantId) as InstanceType<typeof provider.Grant>;
      } else {
        grant = new provider.Grant({
          accountId: session.accountId,
          clientId: params.client_id as string,
        });
      }

      // Adicionar scopes solicitados
      const scopes = (params.scope as string || 'openid').split(' ');
      for (const scope of scopes) {
        grant.addOIDCScope(scope);
      }

      grantId = await grant.save();

      const result = {
        consent: { grantId },
      };

      await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: true });
    } catch (error) {
      logger.error({ error, uid: req.params.uid }, 'Erro no consent da interação OIDC');
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /auth/interaction/:uid/abort - Cancelar interação
  app.post('/auth/interaction/:uid/abort', async (req: Request, res: Response) => {
    try {
      const result = {
        error: 'access_denied',
        error_description: 'End-User aborted interaction',
      };

      await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
    } catch (error) {
      logger.error({ error, uid: req.params.uid }, 'Erro ao abortar interação OIDC');
      res.status(500).json({ error: 'internal_error' });
    }
  });

  logger.info('Rotas OIDC montadas com sucesso');
}

// Exportar tudo
export { createAdapter } from './adapter.js';
export { getJWKS, getPublicJWKS, generateRSAKeyPair } from './jwks.js';
export { createOIDCConfiguration, getIssuerUrl, ISSUER_URL } from './configuration.js';
