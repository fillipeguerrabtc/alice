import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { getDatabase, schema, eq } from '@alice/database';
import { checkPermission, type Role } from '@alice/shared-utils';
import {
  resolveWsAgentAuthDecision,
  resolveWsAgentCloseFrame,
  type WsAgentAuthGovernancePolicy,
} from './ws-agent-auth-governance.js';
import type { WsTokenPayload } from './chat-websocket-runtime.js';

interface AgentWebSocketLogger {
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
  debug: (obj: object | string, msg?: string) => void;
}

interface CounterWithLabel<TLabel extends Record<string, string>> {
  inc: (labels: TLabel) => void;
}

interface InitializeAgentWebSocketRuntimeParams {
  logger: AgentWebSocketLogger;
  server: Server;
  chatWebSocketServer: WebSocketServer;
  verifyWebSocketOrigin: (origin: string | undefined) => boolean;
  verifyWsToken: (token: string, expectedAud?: 'ws' | 'ws-agent') => WsTokenPayload | null;
  consumeWsTokenNonce: (payload: WsTokenPayload) => Promise<{ accepted: boolean; result: string }>;
  wsTokenNonceValidationTotal: CounterWithLabel<{ result: string }>;
  wsAgentAuthFailTotal: CounterWithLabel<{ reason: string }>;
  wsAgentConnectionTotal: CounterWithLabel<{ status: string }>;
  wsAgentAuthGovernance: WsAgentAuthGovernancePolicy;
}

export interface AgentConnection {
  ws: WebSocket;
  userId: string;
  tenantId: string;
  subscribedConversations: Set<string>;
}

export type AgentNotificationEvent = 'new_handoff' | 'new_message' | 'sla_warning' | 'handback';

export interface AgentNotificationPayload {
  conversationId: string;
  tenantId?: string;
  message?: string;
  from?: string;
  trigger?: string;
  priority?: string;
  reason?: string;
}

export interface AgentWebSocketRuntime {
  agentWss: WebSocketServer;
  wsAgentClients: Map<string, AgentConnection>;
  notifyAgentsAboutEvent: (eventType: AgentNotificationEvent, data: AgentNotificationPayload) => void;
}

export function initializeAgentWebSocketRuntime(
  params: InitializeAgentWebSocketRuntimeParams,
): AgentWebSocketRuntime {
  const {
    logger,
    server,
    chatWebSocketServer,
    verifyWebSocketOrigin,
    verifyWsToken,
    consumeWsTokenNonce,
    wsTokenNonceValidationTotal,
    wsAgentAuthFailTotal,
    wsAgentConnectionTotal,
    wsAgentAuthGovernance,
  } = params;

  const db = getDatabase();
  const wsAgentClients = new Map<string, AgentConnection>();
  const agentWss = new WebSocketServer({ noServer: true });

  function notifyAgentsAboutEvent(eventType: AgentNotificationEvent, data: AgentNotificationPayload): void {
    if (!data.tenantId) {
      logger.warn(
        {
          eventType,
          conversationId: data.conversationId,
        },
        'Notificação ignorada - tenantId ausente (violaria isolamento multi-tenant)',
      );
      return;
    }

    let notifiedCount = 0;

    for (const [key, agent] of wsAgentClients.entries()) {
      if (agent.tenantId !== data.tenantId) {
        continue;
      }

      if (eventType === 'new_message') {
        if (agent.subscribedConversations.size > 0 && !agent.subscribedConversations.has(data.conversationId)) {
          continue;
        }
      }

      try {
        agent.ws.send(
          JSON.stringify({
            type: 'agent_notification',
            event: eventType,
            data: {
              conversationId: data.conversationId,
              message: data.message,
              from: data.from,
              trigger: data.trigger,
              priority: data.priority,
            },
            timestamp: new Date().toISOString(),
          }),
        );

        notifiedCount++;

        logger.debug(
          {
            agentKey: key,
            eventType,
            conversationId: data.conversationId,
          },
          'Agente notificado sobre evento',
        );
      } catch (error) {
        logger.warn({ error, agentKey: key }, 'Falha ao notificar agente');
        wsAgentClients.delete(key);
      }
    }

    if (notifiedCount === 0 && eventType === 'new_handoff') {
      logger.warn(
        {
          eventType,
          conversationId: data.conversationId,
          tenantId: data.tenantId,
        },
        'Nenhum agente online para receber handoff - SLA pode ser impactado',
      );
    }
  }

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', 'ws://localhost').pathname;

    if (pathname === '/ws/agent') {
      agentWss.handleUpgrade(request, socket, head, (ws) => {
        agentWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/chat') {
      chatWebSocketServer.handleUpgrade(request, socket, head, (ws) => {
        chatWebSocketServer.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  agentWss.on('connection', async (ws, req) => {
    if (!verifyWebSocketOrigin(req.headers.origin)) {
      wsAgentConnectionTotal.inc({ status: 'rejected' });
      ws.close(4000, 'Origin nao permitido');
      return;
    }

    const urlParams = new URL(req.url || '', 'ws://localhost').searchParams;
    const wsToken = urlParams.get('token');
    const normalizedWsToken = wsToken?.trim() ?? '';
    const hasWsToken = normalizedWsToken.length > 0;
    let tokenPayload = hasWsToken ? verifyWsToken(normalizedWsToken, 'ws-agent') : null;
    let authRejectedReason: 'missing_token' | 'invalid_token' | null = null;
    const authDecision = resolveWsAgentAuthDecision({
      hasWsToken,
      tokenPayloadValid: Boolean(tokenPayload),
      policy: wsAgentAuthGovernance,
    });

    if (authDecision.rejectReason) {
      authRejectedReason = authDecision.rejectReason;
    }

    if (hasWsToken && tokenPayload) {
      const nonceValidation = await consumeWsTokenNonce(tokenPayload);
      wsTokenNonceValidationTotal.inc({ result: nonceValidation.result });
      if (!nonceValidation.accepted) {
        logger.warn(
          {
            result: nonceValidation.result,
            tenantId: tokenPayload.tenantId,
            aud: tokenPayload.aud,
          },
          'Conexao /ws/agent rejeitada por replay/invalidacao de ws-token',
        );
        authRejectedReason = 'invalid_token';
        tokenPayload = null;
      }
    }

    if (!tokenPayload) {
      wsAgentAuthFailTotal.inc({ reason: authRejectedReason ?? 'unknown' });
      wsAgentConnectionTotal.inc({ status: 'rejected' });
      logger.warn(
        {
          reason: authRejectedReason ?? 'unknown',
          hasWsToken,
          requireWsAgentToken: wsAgentAuthGovernance.requireWsAgentToken,
          allowLegacySessionFallback: wsAgentAuthGovernance.allowLegacySessionFallback,
        },
        'Conexao /ws/agent rejeitada por autenticacao',
      );
      const closeFrame = resolveWsAgentCloseFrame(authRejectedReason ?? 'unknown');
      ws.close(closeFrame.code, closeFrame.reason);
      return;
    }

    const queryAgentId = urlParams.get('agentId');
    const queryTenantId = urlParams.get('tenantId');
    if (queryAgentId && queryAgentId !== tokenPayload.userId) {
      wsAgentConnectionTotal.inc({ status: 'rejected' });
      ws.close(4002, 'agentId divergente do token');
      return;
    }
    if (queryTenantId && queryTenantId !== tokenPayload.tenantId) {
      wsAgentConnectionTotal.inc({ status: 'rejected' });
      ws.close(4003, 'tenantId divergente do token');
      return;
    }

    const agentId = tokenPayload.userId;
    const claimedTenantId = tokenPayload.tenantId;

    try {
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, agentId),
      });

      if (!user) {
        logger.warn({ agentId, claimedTenantId }, 'Agente não encontrado no banco de dados');
        wsAgentConnectionTotal.inc({ status: 'rejected' });
        ws.close(4003, 'Agente não encontrado');
        return;
      }

      const safeTenantId = user.tenantId;

      if (!safeTenantId) {
        logger.warn({ agentId }, 'Agente sem tenant associado');
        wsAgentConnectionTotal.inc({ status: 'rejected' });
        ws.close(4004, 'Agente sem tenant associado');
        return;
      }

      if (claimedTenantId !== safeTenantId) {
        logger.warn(
          {
            agentId,
            claimedTenantId,
            actualTenantId: safeTenantId,
          },
          'Tentativa de conexão WebSocket com tenant incorreto - possível ataque',
        );
        wsAgentConnectionTotal.inc({ status: 'rejected' });
        ws.close(4005, 'Tenant inválido para este agente');
        return;
      }

      const userRole = user.role as Role;

      if (!userRole) {
        logger.warn({ agentId, safeTenantId }, 'Agente sem role definida');
        wsAgentConnectionTotal.inc({ status: 'rejected' });
        ws.close(4006, 'Sem permissão para takeover');
        return;
      }

      const permissionCheck = await checkPermission(
        { userId: agentId, tenantId: safeTenantId, role: userRole },
        'chat:takeover:write',
      );

      if (!permissionCheck.allowed) {
        logger.warn(
          {
            agentId,
            safeTenantId,
            role: userRole,
            reason: permissionCheck.reason,
          },
          'Agente sem permissão de takeover',
        );
        wsAgentConnectionTotal.inc({ status: 'rejected' });
        ws.close(4006, 'Sem permissão para takeover');
        return;
      }

      const agentKey = `${safeTenantId}:${agentId}`;

      wsAgentClients.set(agentKey, {
        ws,
        userId: agentId,
        tenantId: safeTenantId,
        subscribedConversations: new Set(),
      });

      logger.info({ agentId, tenantId: safeTenantId, agentKey }, 'Agente conectado ao WebSocket de takeover');
      wsAgentConnectionTotal.inc({ status: 'accepted' });

      ws.send(
        JSON.stringify({
          type: 'connected',
          agentId,
          tenantId: safeTenantId,
          timestamp: new Date().toISOString(),
        }),
      );

      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString()) as {
            type: string;
            conversationId?: string;
          };

          if (message.type === 'subscribe' && message.conversationId) {
            const agent = wsAgentClients.get(agentKey);
            if (agent) {
              agent.subscribedConversations.add(message.conversationId);
              ws.send(
                JSON.stringify({
                  type: 'subscribed',
                  conversationId: message.conversationId,
                }),
              );
              logger.debug({ agentKey, conversationId: message.conversationId }, 'Agente inscrito em conversa');
            }
          }

          if (message.type === 'unsubscribe' && message.conversationId) {
            const agent = wsAgentClients.get(agentKey);
            if (agent) {
              agent.subscribedConversations.delete(message.conversationId);
              ws.send(
                JSON.stringify({
                  type: 'unsubscribed',
                  conversationId: message.conversationId,
                }),
              );
            }
          }

          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          }
        } catch (error) {
          logger.error({ error }, 'Erro ao processar mensagem de agente WebSocket');
        }
      });

      ws.on('close', () => {
        wsAgentClients.delete(agentKey);
        logger.info({ agentId, tenantId: safeTenantId, agentKey }, 'Agente desconectado do WebSocket de takeover');
      });

      ws.on('error', (error) => {
        logger.error({ error, agentKey }, 'Erro no WebSocket do agente');
        wsAgentClients.delete(agentKey);
      });
    } catch (error) {
      logger.error({ error, agentId }, 'Erro ao validar agente para WebSocket');
      wsAgentConnectionTotal.inc({ status: 'rejected' });
      ws.close(4000, 'Erro interno de autenticação');
    }
  });

  return {
    agentWss,
    wsAgentClients,
    notifyAgentsAboutEvent,
  };
}
