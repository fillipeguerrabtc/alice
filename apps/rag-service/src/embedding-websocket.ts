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
/** Referência ao subscriber Redis para cleanup no shutdown (Bug fix: evitar resource leak) */
let redisSubscriber: ReturnType<typeof getRedisClient> | null = null;

/**
 * Inicializa o servidor WebSocket para notificações de embeddings
 * 
 * BUG FIX 23/12/2025: Tornado async para aguardar inicialização do Redis Pub/Sub
 * Evita race condition onde clientes WebSocket podem conectar antes do Redis estar pronto
 * 
 * DEPENDÊNCIAS CRÍTICAS:
 * - Redis Pub/Sub deve estar inicializado ANTES de aceitar conexões
 * - Esta função aguarda initRedisPubSub() antes de retornar
 * - O servidor HTTP não deve iniciar (server.listen()) até que esta função complete
 * 
 * ORDEM DE INICIALIZAÇÃO:
 * 1. Redis cache inicializado (initializeRedisCache)
 * 2. Servidor HTTP criado mas NÃO iniciado (http.createServer)
 * 3. Esta função chamada e aguardada (await initEmbeddingWebSocket)
 * 4. Servidor HTTP iniciado (server.listen) - APENAS após Redis Pub/Sub estar pronto
 * 
 * @param server - Servidor HTTP que será usado pelo WebSocket (não deve estar escutando ainda)
 * @returns Promise que resolve quando Redis Pub/Sub está inicializado e WebSocket está pronto
 */
export async function initEmbeddingWebSocket(server: Server): Promise<void> {
  if (wss) {
    logger.warn('WebSocket server já inicializado');
    return;
  }
  
  // BUG FIX 23/12/2025: WebSocket server criado mas handlers só funcionam após Redis estar pronto
  // O servidor HTTP não está escutando ainda, então não há race condition
  // Mas garantimos que Redis Pub/Sub esteja inicializado antes de retornar
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
  
  // BUG FIX 23/12/2025: Aguardar inicialização do Redis Pub/Sub antes de aceitar conexões
  // initRedisPubSub() é async e precisa ser aguardado para evitar race condition
  // WebSocket clients podem conectar antes do Redis estar pronto, causando falhas silenciosas
  // BUG FIX 23/12/2025: Tratamento de erro explícito - se Redis Pub/Sub falhar, WebSocket não deve funcionar
  // initRedisPubSub() agora retorna boolean - false indica que Redis não está disponível ou falhou
  // Em produção, Redis é obrigatório - falha deve causar erro crítico (Regra 6 - sem workarounds)
  try {
    const redisPubSubInitialized = await initRedisPubSub();
    
    if (!redisPubSubInitialized) {
      // Redis não disponível ou falhou - comportamento depende do ambiente
      // Em produção, isso é erro crítico (Redis é obrigatório para Pub/Sub)
      // Em desenvolvimento, permitir continuar mas com funcionalidade limitada
      const error = new Error('Redis Pub/Sub não disponível - WebSocket não pode funcionar corretamente');
      logger.error({ error }, 'CRITICAL: Falha ao inicializar Redis Pub/Sub para WebSocket');
      
      // Limpar recursos criados antes de lançar erro
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      if (wss) {
        wss.close();
        wss = null;
      }
      
      // Propagar erro para o caller tratar adequadamente (index.ts verifica isProduction)
      throw error;
    }
    
    logger.info({ path: '/ws/embeddings' }, 'WebSocket server para embeddings iniciado');
  } catch (redisError) {
    logger.error({ error: redisError }, 'CRITICAL: Falha ao inicializar Redis Pub/Sub para WebSocket');
    // Limpar recursos criados antes de lançar erro
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (wss) {
      wss.close();
      wss = null;
    }
    // Propagar erro para o caller tratar adequadamente
    throw redisError;
  }
}

/**
 * Encerra o servidor WebSocket
 */
export async function closeEmbeddingWebSocket(): Promise<void> {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  
  // Bug fix: Fechar conexão Redis subscriber para evitar resource leak
  if (redisSubscriber) {
    try {
      await redisSubscriber.quit();
      logger.info('Redis subscriber para WebSocket encerrado');
    } catch (error) {
      logger.warn({ error }, 'Erro ao fechar Redis subscriber (não crítico)');
    }
    redisSubscriber = null;
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

// BUG FIX 23/12/2025: Retornar boolean para indicar sucesso/falha ao invés de retornar silenciosamente
// Isso permite que initEmbeddingWebSocket verifique se Redis Pub/Sub foi realmente inicializado
// Em produção, Redis é obrigatório - falha deve ser tratada como erro crítico
async function initRedisPubSub(): Promise<boolean> {
  const client = getRedisClient();
  
  if (!client) {
    logger.warn('Redis não disponível - notificações WebSocket desabilitadas');
    return false;
  }
  
  try {
    // Criar subscriber separado (Redis Pub/Sub requer conexão dedicada)
    // Bug fix: Armazenar referência para cleanup no shutdown
    const subscriber = client.duplicate();
    await subscriber.connect();
    
    // Armazenar referência em variável de módulo para cleanup (evitar resource leak)
    redisSubscriber = subscriber;
    
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
    return true;
  } catch (error) {
    logger.error({ error }, 'Erro ao inicializar Redis Pub/Sub');
    // Retornar false para indicar falha - erro será tratado pelo caller
    return false;
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
