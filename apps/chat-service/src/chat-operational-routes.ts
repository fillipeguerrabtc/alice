import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  checkPermission,
  getRedisClient,
  requireAuth,
  type Role,
} from '@alice/shared-utils';
import { z } from 'zod';
import type { WsTokenPayload } from './chat-websocket-runtime.js';

interface ChatOperationalLogger {
  debug: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
}

interface CircuitBreakerSnapshot {
  opened: boolean;
  halfOpen: boolean;
  stats: {
    failures: number;
    successes: number;
    timeouts: number;
  };
}

interface IntegrationsBreakerSnapshot {
  state: string;
}

interface WsAgentAuthGovernanceSnapshot {
  requireWsAgentToken: boolean;
  allowLegacySessionFallback: boolean;
}

interface CreateChatOperationalRuntimeParams {
  logger: ChatOperationalLogger;
  sessionSecret: string;
  parseEnvBool: (value: string | undefined, defaultValue: boolean, name: string) => boolean;
}

interface RegisterChatOperationalRoutesParams {
  app: Express;
  logger: ChatOperationalLogger;
  appVersion: string | null | undefined;
  allowedAgentLlmModelNames: readonly string[];
  countAgentsWithUnsupportedLlmModel: () => Promise<number>;
  getIntegrationsBreakerStats: () => IntegrationsBreakerSnapshot;
  getLlmCircuitBreakerSnapshot: () => CircuitBreakerSnapshot;
  getRagBreakerStats: () => unknown;
  isPoolHealthy: () => Promise<boolean>;
  publicModelName: string;
  servingModelId: string;
  wsAgentAuthGovernance: WsAgentAuthGovernanceSnapshot;
}

export function createChatOperationalRuntime(
  params: CreateChatOperationalRuntimeParams,
): {
  verifyWsToken: (token: string, expectedAud?: 'ws' | 'ws-agent') => WsTokenPayload | null;
  consumeWsTokenNonce: (
    payload: WsTokenPayload,
  ) => Promise<{ accepted: boolean; result: 'accepted' | 'replay' | 'redis_unavailable' | 'redis_error' | 'disabled' }>;
  registerRoutes: (params: RegisterChatOperationalRoutesParams) => void;
} {
  const { logger, sessionSecret, parseEnvBool } = params;

  const WS_TOKEN_SECRET = process.env.WS_TOKEN_SECRET || sessionSecret;
  const WS_TOKEN_TTL_SECONDS = Number(process.env.WS_TOKEN_TTL_SECONDS ?? '60');
  const WS_TOKEN_ONE_TIME_USE_REQUIRED = parseEnvBool(
    process.env.WS_TOKEN_ONE_TIME_USE_REQUIRED,
    process.env.NODE_ENV === 'production',
    'WS_TOKEN_ONE_TIME_USE_REQUIRED',
  );
  const WS_TOKEN_NONCE_REDIS_PREFIX = 'alice:chat:ws-token:nonce';
  const wsTokenAuth = requireAuth({ allowAnonymous: true, logUnauthorized: false });
  const wsTokenQuerySchema = z.object({
    aud: z.enum(['ws', 'ws-agent']).default('ws'),
  });

  function generateWsToken(
    payload: { userId: string; tenantId: string; role: string },
    aud: 'ws' | 'ws-agent' = 'ws',
  ): string {
    const nonce = crypto.randomUUID();
    const exp = Math.floor(Date.now() / 1000) + WS_TOKEN_TTL_SECONDS;
    const data = JSON.stringify({ ...payload, nonce, exp, aud });
    const signature = crypto.createHmac('sha256', WS_TOKEN_SECRET).update(data).digest('hex');
    return Buffer.from(`${data}.${signature}`).toString('base64url');
  }

  function verifyWsToken(
    token: string,
    expectedAud: 'ws' | 'ws-agent' = 'ws',
  ): WsTokenPayload | null {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const dotIndex = decoded.lastIndexOf('.');
      if (dotIndex === -1) return null;

      const data = decoded.slice(0, dotIndex);
      const signature = decoded.slice(dotIndex + 1);
      const expectedSig = crypto.createHmac('sha256', WS_TOKEN_SECRET).update(data).digest('hex');

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        return null;
      }

      const payload = JSON.parse(data) as WsTokenPayload;
      if (payload.aud !== expectedAud) return null;
      if (payload.exp < Math.floor(Date.now() / 1000)) return null;
      if (!payload.nonce || typeof payload.nonce !== 'string') return null;

      return payload;
    } catch {
      return null;
    }
  }

  async function consumeWsTokenNonce(
    payload: WsTokenPayload,
  ): Promise<{ accepted: boolean; result: 'accepted' | 'replay' | 'redis_unavailable' | 'redis_error' | 'disabled' }> {
    if (!WS_TOKEN_ONE_TIME_USE_REQUIRED) {
      return { accepted: true, result: 'disabled' };
    }

    const redis = getRedisClient();
    if (!redis) {
      return { accepted: false, result: 'redis_unavailable' };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlMs = Math.max(1000, (payload.exp - nowSeconds + 5) * 1000);
    const redisKey = `${WS_TOKEN_NONCE_REDIS_PREFIX}:${payload.aud}:${payload.tenantId}:${payload.nonce}`;

    try {
      const lock = await redis.set(redisKey, '1', { NX: true, PX: ttlMs });
      if (lock !== 'OK') {
        return { accepted: false, result: 'replay' };
      }

      return { accepted: true, result: 'accepted' };
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          tenantId: payload.tenantId,
          aud: payload.aud,
        },
        'Falha ao validar nonce one-time-use do ws-token',
      );
      return { accepted: false, result: 'redis_error' };
    }
  }

  function registerRoutes(routeParams: RegisterChatOperationalRoutesParams): void {
    const {
      app,
      logger: routeLogger,
      appVersion,
      allowedAgentLlmModelNames,
      countAgentsWithUnsupportedLlmModel,
      getIntegrationsBreakerStats,
      getLlmCircuitBreakerSnapshot,
      getRagBreakerStats,
      isPoolHealthy,
      publicModelName,
      servingModelId,
      wsAgentAuthGovernance,
    } = routeParams;

    app.get('/api/chat/health', async (_req: Request, res: Response) => {
      const llmCircuit = getLlmCircuitBreakerSnapshot();
      const llmCircuitState = llmCircuit.opened ? 'open' : (llmCircuit.halfOpen ? 'half-open' : 'closed');
      const ragStats = getRagBreakerStats();
      const integrationsStats = getIntegrationsBreakerStats();
      const overallStatus = (llmCircuitState === 'open' || integrationsStats.state === 'open') ? 'degraded' : 'ok';

      let invalidAgentsCount: number | null = null;
      try {
        invalidAgentsCount = await countAgentsWithUnsupportedLlmModel();
      } catch (error) {
        routeLogger.warn({ error }, 'Falha ao checar agentes com modeloBase invalido (health)');
        invalidAgentsCount = null;
      }

      res.json({
        status: overallStatus,
        service: 'chat-service',
        timestamp: new Date().toISOString(),
        llmProvider: 'gpu-manager-service',
        model: servingModelId,
        agents: {
          allowedModels: allowedAgentLlmModelNames,
          invalidModelCount: invalidAgentsCount,
        },
        websocket: {
          agentAuth: {
            requireWsAgentToken: wsAgentAuthGovernance.requireWsAgentToken,
            allowLegacySessionFallback: wsAgentAuthGovernance.allowLegacySessionFallback,
          },
        },
        circuitBreakers: {
          llm: {
            state: llmCircuitState,
            stats: {
              failures: llmCircuit.stats.failures,
              successes: llmCircuit.stats.successes,
              timeouts: llmCircuit.stats.timeouts,
            },
          },
          rag: ragStats,
          integrations: integrationsStats,
        },
      });
    });

    app.get('/api/chat/version', (_req: Request, res: Response) => {
      res.json({
        version: appVersion,
        publicModelName,
        servingModelId,
        service: 'chat-service',
        timestamp: new Date().toISOString(),
      });
    });

    app.get('/api/chat/ws-token', wsTokenAuth, async (req: Request, res: Response) => {
      try {
        const userId = req.user?.userId;
        const tenantId = req.user?.tenantId ?? req.tenantId;
        const role = req.user?.role;
        const correlationId = req.headers['x-correlation-id'] as string | undefined;

        if (!userId || !tenantId) {
          routeLogger.debug(
            {
              correlationId,
              ip: req.ip,
              statusCode: 401,
            },
            'ws-token solicitado sem autenticacao',
          );
          res.status(401).json({ error: 'Autenticacao necessaria' });
          return;
        }

        const queryParsed = wsTokenQuerySchema.safeParse(req.query);
        if (!queryParsed.success) {
          res.status(400).json({ error: 'Parametro aud invalido' });
          return;
        }

        const aud = queryParsed.data.aud;
        const safeRole = (role ?? 'viewer') as Role;
        if (aud === 'ws-agent') {
          const permissionCheck = await checkPermission(
            { userId, tenantId, role: safeRole },
            'chat:takeover:write',
          );
          if (!permissionCheck.allowed) {
            res.status(403).json({ error: 'Permissao insuficiente para ws-agent' });
            return;
          }
        }

        const token = generateWsToken({ userId, tenantId, role: safeRole }, aud);
        res.json({ success: true, data: { token, expiresIn: WS_TOKEN_TTL_SECONDS, aud } });
      } catch (error) {
        routeLogger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Erro ao gerar ws-token',
        );
        res.status(500).json({ error: 'Erro ao gerar token WebSocket' });
      }
    });

    app.get('/live', (_req: Request, res: Response) => {
      res.status(200).json({
        status: 'alive',
        service: 'chat-service',
        timestamp: new Date().toISOString(),
      });
    });

    app.get('/ready', async (_req: Request, res: Response) => {
      try {
        const dbHealthy = await isPoolHealthy();
        const llmReady = !getLlmCircuitBreakerSnapshot().opened;
        const invalidAgentsCount = dbHealthy ? await countAgentsWithUnsupportedLlmModel() : 0;

        if (dbHealthy) {
          res.status(200).json({
            status: 'ready',
            service: 'chat-service',
            timestamp: new Date().toISOString(),
            dependencies: {
              postgresql: 'ready',
              llm: llmReady ? 'ready' : 'circuit_open',
              agents: invalidAgentsCount > 0 ? 'legacy_models_present' : 'ready',
            },
            warnings: invalidAgentsCount > 0 ? [{
              code: 'LEGACY_AGENT_LLM_MODEL',
              message:
                `Detectados ${invalidAgentsCount} agentes com modeloBase nao suportado para LLM (texto) no Gate 3. ` +
                `Atualize os agentes para '${publicModelName}'.`,
            }] : [],
          });
          return;
        }

        res.status(503).json({
          status: 'not_ready',
          service: 'chat-service',
          reason: 'PostgreSQL nao esta acessivel',
          timestamp: new Date().toISOString(),
          dependencies: {
            postgresql: 'not_ready',
            llm: llmReady ? 'ready' : 'circuit_open',
            agents: 'unknown',
          },
        });
      } catch (error) {
        routeLogger.error({ error }, 'Erro ao verificar readiness');
        res.status(503).json({
          status: 'not_ready',
          service: 'chat-service',
          reason: 'Erro ao verificar dependencias',
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  return {
    verifyWsToken,
    consumeWsTokenNonce,
    registerRoutes,
  };
}
