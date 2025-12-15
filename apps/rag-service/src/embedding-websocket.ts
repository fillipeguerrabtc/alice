/**
 * Embedding WebSocket Handler - Alice Enterprise Platform
 * 
 * WebSocket para notificações em tempo real de embeddings prontos.
 * Integra com Redis Pub/Sub para escalar horizontalmente.
 * 
 * Features:
 * - Notificações em tempo real quando embedding está pronto
 * - Suporte a múltiplas conexões por tenant
 * - Heartbeat para manter conexões vivas
 * - Reconexão automática (cliente)
 * 
 * Autor: Fillipe Guerra
 * Data: 15 de Dezembro de 2025
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '@alice/logger';
import { getRedisClient } from '@alice/shared-utils';
import { getNotificationChannel, type EmbeddingNotification } from './embedding-queue.js';
import type { Server } from 'http';

const logger = createLogger('embedding-websocket');

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

/** Intervalo de heartbeat em ms (30 segundos) */
const HEARTBEAT_INTERVAL_MS = 30000;

/** Timeout para conexões inativas em ms (2 minutos) */
const CONNECTION_TIMEOUT_MS = 120000;

// ============================================================================
// TIPOS
// ============================================================================

interface AuthenticatedWebSocket extends WebSocket {
  tenantId?: string;
  userId?: string;
  isAlive: boolean;
  subscribedJobs: Set<string>;
}

interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping';
  jobIds?: string[];
}

// ============================================================================
// WEBSOCKET SERVER
// ============================================================================

let wss: WebSocketServer | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

/**
 * Inicializa o servidor WebSocket para notificações de embeddings
 */
export function initEmbeddingWebSocket(server: Server): void {
  if (wss) {
    logger.warn('WebSocket server já inicializado');
    return;
  }
  
  wss = new WebSocketServer({ 
    server,
    path: '/ws/embeddings',
  });
  
  wss.on('connection', (ws: AuthenticatedWebSocket, req) => {
    // Extrair tenant e user do header (JWT já validado pelo API Gateway)
    const tenantId = req.headers['x-tenant-id'] as string;
    const userId = req.headers['x-user-id'] as string;
    
    if (!tenantId) {
      logger.warn('Conexão WebSocket rejeitada: tenant não identificado');
      ws.close(4001, 'Unauthorized: tenant not identified');
      return;
    }
    
    ws.tenantId = tenantId;
    ws.userId = userId;
    ws.isAlive = true;
    ws.subscribedJobs = new Set();
    
    logger.info({ tenantId, userId }, 'Nova conexão WebSocket para embeddings');
    
    // Handler de mensagens
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as WebSocketMessage;
        handleMessage(ws, message);
      } catch (error) {
        logger.warn({ error }, 'Mensagem WebSocket inválida');
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });
    
    // Handler de pong (resposta ao ping)
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    
    // Handler de fechamento
    ws.on('close', () => {
      logger.info({ tenantId, userId }, 'Conexão WebSocket fechada');
    });
    
    // Enviar mensagem de boas-vindas
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Conectado ao servidor de notificações de embeddings',
      timestamp: new Date().toISOString(),
    }));
  });
  
  // Heartbeat para detectar conexões mortas
  heartbeatInterval = setInterval(() => {
    wss?.clients.forEach((ws) => {
      const authWs = ws as AuthenticatedWebSocket;
      
      if (!authWs.isAlive) {
        logger.debug({ tenantId: authWs.tenantId }, 'Encerrando conexão inativa');
        return ws.terminate();
      }
      
      authWs.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);
  
  // Iniciar listener Redis Pub/Sub
  initRedisPubSub();
  
  logger.info({ path: '/ws/embeddings' }, 'WebSocket server para embeddings iniciado');
}

/**
 * Encerra o servidor WebSocket
 */
export function closeEmbeddingWebSocket(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  
  if (wss) {
    wss.close();
    wss = null;
  }
  
  logger.info('WebSocket server para embeddings encerrado');
}

// ============================================================================
// HANDLERS
// ============================================================================

function handleMessage(ws: AuthenticatedWebSocket, message: WebSocketMessage): void {
  switch (message.type) {
    case 'subscribe':
      if (message.jobIds && Array.isArray(message.jobIds)) {
        message.jobIds.forEach(jobId => ws.subscribedJobs.add(jobId));
        
        ws.send(JSON.stringify({
          type: 'subscribed',
          jobIds: message.jobIds,
          timestamp: new Date().toISOString(),
        }));
        
        logger.debug({
          tenantId: ws.tenantId,
          jobIds: message.jobIds,
        }, 'Cliente inscrito em jobs');
      }
      break;
      
    case 'unsubscribe':
      if (message.jobIds && Array.isArray(message.jobIds)) {
        message.jobIds.forEach(jobId => ws.subscribedJobs.delete(jobId));
        
        ws.send(JSON.stringify({
          type: 'unsubscribed',
          jobIds: message.jobIds,
          timestamp: new Date().toISOString(),
        }));
      }
      break;
      
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      break;
      
    default:
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
  }
}

// ============================================================================
// REDIS PUB/SUB
// ============================================================================

async function initRedisPubSub(): Promise<void> {
  const client = getRedisClient();
  
  if (!client) {
    logger.warn('Redis não disponível - notificações WebSocket desabilitadas');
    return;
  }
  
  try {
    // Criar subscriber separado (Redis Pub/Sub requer conexão dedicada)
    const subscriber = client.duplicate();
    await subscriber.connect();
    
    const channel = getNotificationChannel();
    
    await subscriber.subscribe(channel, (message) => {
      try {
        const notification = JSON.parse(message) as EmbeddingNotification;
        broadcastNotification(notification);
      } catch (error) {
        logger.error({ error }, 'Erro ao processar notificação Redis');
      }
    });
    
    logger.info({ channel }, 'Redis Pub/Sub inicializado para notificações');
  } catch (error) {
    logger.error({ error }, 'Erro ao inicializar Redis Pub/Sub');
  }
}

function broadcastNotification(notification: EmbeddingNotification): void {
  if (!wss) return;
  
  let sent = 0;
  
  wss.clients.forEach((ws) => {
    const authWs = ws as AuthenticatedWebSocket;
    
    // Verificar se é o mesmo tenant
    if (authWs.tenantId !== notification.tenantId) {
      return;
    }
    
    // Verificar se está inscrito no job (ou enviar para todos do tenant)
    const shouldSend = !notification.jobId || 
                       authWs.subscribedJobs.size === 0 || 
                       authWs.subscribedJobs.has(notification.jobId);
    
    if (shouldSend && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(notification));
      sent++;
    }
  });
  
  if (sent > 0) {
    logger.debug({
      type: notification.type,
      jobId: notification.jobId,
      tenantId: notification.tenantId,
      clientsNotified: sent,
    }, 'Notificação enviada via WebSocket');
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Retorna estatísticas das conexões WebSocket
 */
export function getWebSocketStats(): {
  connections: number;
  byTenant: Record<string, number>;
} {
  if (!wss) {
    return { connections: 0, byTenant: {} };
  }
  
  const byTenant: Record<string, number> = {};
  
  wss.clients.forEach((ws) => {
    const authWs = ws as AuthenticatedWebSocket;
    if (authWs.tenantId) {
      byTenant[authWs.tenantId] = (byTenant[authWs.tenantId] || 0) + 1;
    }
  });
  
  return {
    connections: wss.clients.size,
    byTenant,
  };
}
