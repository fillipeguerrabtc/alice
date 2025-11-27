/**
 * Chat Service - Alice Enterprise Platform
 * 
 * Serviço de chat com WebSocket tempo real e integração LLM Salad Cloud.
 * Integra com RAG Service para contexto de documentos (Fase 3 - Integração Chat+RAG).
 * Implementa Circuit Breaker pattern (Regra 16 - Best Practices 2025).
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import CircuitBreaker from 'opossum';
import pino from 'pino';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '../../../shared/schema.js';
import { 
  requirePermission, 
  requireAuth,
  requireSameTenant,
  extractAuthContext,
} from '../../../packages/shared-utils/src/rbac/middleware.js';
import { 
  buscarContextoRAG, 
  formatarContextoParaLLM, 
  getRAGBreakerStats,
  RAGContextResponse,
} from './rag-client.js';
import {
  initOrchestrator,
  getOrCreateConversationState,
  inititateTakeover,
  handbackToBot,
  processAutoEscalation,
  shouldEscalate,
  getPendingHandoffs,
  getUrgentConversations,
  checkSLABreaches,
  ESCALATION_CONFIG,
} from './conversation-orchestrator.js';
import {
  initImageGeneration,
  generateImage,
  rateImage,
  approveForTraining,
  getImageGenerationStats,
  getImageGenBreakerStats,
} from './image-generation-client.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ service: 'chat-service' });

const PORT = process.env.PORT || 3002;
const DATABASE_URL = process.env.DATABASE_URL;
const SALAD_API_KEY = process.env.SALAD_API_KEY;
const SALAD_ORGANIZATION_ID = process.env.SALAD_ORGANIZATION_ID;
const SALAD_API_URL = process.env.SALAD_API_URL || 'https://api.salad.com/api/public';
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',') || [];

const getTenantIdFromRequest = (req: Request): string | undefined => {
  return req.headers['x-tenant-id'] as string | undefined;
};

if (!DATABASE_URL) {
  logger.error('DATABASE_URL não configurada');
  process.exit(1);
}

if (!SALAD_API_KEY) {
  logger.error('SALAD_API_KEY não configurada - serviço requer API key para funcionar');
  process.exit(1);
}

if (!SALAD_ORGANIZATION_ID) {
  logger.error('SALAD_ORGANIZATION_ID não configurada');
  process.exit(1);
}

const SALAD_KEY: string = SALAD_API_KEY;
const SALAD_ORG: string = SALAD_ORGANIZATION_ID;

const sql = neon(DATABASE_URL);
const db = drizzle(sql, { schema });

initOrchestrator(db);
initImageGeneration(db);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/chat' });

// ============================================================================
// CIRCUIT BREAKER - Salad Cloud LLM API (Regra 16 - Best Practices 2025)
// ============================================================================

const circuitBreakerOptions = {
  timeout: 60000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
};

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  choices: Array<{
    message: { content: string };
    delta?: { content?: string };
  }>;
}

interface LLMRequest {
  messages: LLMMessage[];
  stream: boolean;
}

async function callLlamaAPIInternal(request: LLMRequest): Promise<globalThis.Response> {
  const response = await fetch(`${SALAD_API_URL}/organizations/${SALAD_ORG}/inference-endpoints/llama4-maverick/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Salad-Api-Key': SALAD_KEY,
    },
    body: JSON.stringify({
      model: 'llama4-maverick',
      messages: request.messages,
      max_tokens: 4096,
      temperature: 0.7,
      stream: request.stream,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Erro na API LLM: ${error}`);
  }

  return response;
}

const saladCloudBreaker = new CircuitBreaker(callLlamaAPIInternal, circuitBreakerOptions);

saladCloudBreaker.on('open', () => {
  logger.warn('Circuit breaker Salad Cloud LLM: ABERTO - API temporariamente indisponível');
});
saladCloudBreaker.on('halfOpen', () => {
  logger.info('Circuit breaker Salad Cloud LLM: HALF-OPEN - Testando reconexão');
});
saladCloudBreaker.on('close', () => {
  logger.info('Circuit breaker Salad Cloud LLM: FECHADO - API funcionando normalmente');
});
saladCloudBreaker.on('fallback', () => {
  logger.warn('Circuit breaker Salad Cloud LLM: Usando fallback');
});

async function callLlamaAPI(messages: LLMMessage[], stream = false): Promise<string | AsyncGenerator<string>> {
  try {
    const response = await saladCloudBreaker.fire({ messages, stream }) as globalThis.Response;

    if (stream) {
      return streamResponse(response);
    }

    const data = await response.json() as LLMResponse;
    return data.choices[0]?.message?.content || '';
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      logger.warn('Circuit breaker aberto - LLM temporariamente indisponível');
      throw new Error('Serviço de IA temporariamente indisponível. Tente novamente em alguns segundos.');
    }
    throw error;
  }
}

async function* streamResponse(response: globalThis.Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        
        try {
          const parsed = JSON.parse(data) as LLMResponse;
          const content = parsed.choices[0]?.delta?.content;
          if (content) yield content;
        } catch {
          continue;
        }
      }
    }
  }
}

app.use(helmet());
app.use(cors({
  origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
  credentials: CORS_ORIGINS.length > 0,
}));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Muitas requisições. Tente novamente em 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use(express.json());

app.get('/api/chat/health', (_req: Request, res: Response) => {
  const llmCircuitState = saladCloudBreaker.opened ? 'open' : (saladCloudBreaker.halfOpen ? 'half-open' : 'closed');
  const ragStats = getRAGBreakerStats();
  
  const overallStatus = llmCircuitState === 'open' ? 'degraded' : 'ok';
  
  res.json({ 
    status: overallStatus, 
    service: 'chat-service', 
    timestamp: new Date().toISOString(),
    llmProvider: 'salad-cloud',
    model: 'llama4-maverick',
    circuitBreakers: {
      llm: {
        state: llmCircuitState,
        stats: {
          failures: saladCloudBreaker.stats.failures,
          successes: saladCloudBreaker.stats.successes,
          timeouts: saladCloudBreaker.stats.timeouts,
        },
      },
      rag: ragStats,
    },
  });
});

app.get('/api/chat/stats', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const allConversations = await db.query.conversations.findMany();
    const allDocuments = await db.query.documents.findMany();
    const allTraining = await db.query.trainingData.findMany();
    const allMessages = await db.query.messages.findMany();

    const currentConversations = allConversations.filter(c => 
      c.criadoEm && new Date(c.criadoEm) >= weekAgo
    ).length;
    const previousConversations = allConversations.filter(c => 
      c.criadoEm && new Date(c.criadoEm) >= twoWeeksAgo && new Date(c.criadoEm) < weekAgo
    ).length;

    const currentDocuments = allDocuments.filter(d => 
      d.criadoEm && new Date(d.criadoEm) >= weekAgo
    ).length;
    const previousDocuments = allDocuments.filter(d => 
      d.criadoEm && new Date(d.criadoEm) >= twoWeeksAgo && new Date(d.criadoEm) < weekAgo
    ).length;

    const currentTraining = allTraining.filter(t => 
      t.criadoEm && new Date(t.criadoEm) >= weekAgo
    ).length;
    const previousTraining = allTraining.filter(t => 
      t.criadoEm && new Date(t.criadoEm) >= twoWeeksAgo && new Date(t.criadoEm) < weekAgo
    ).length;

    const totalTokens = allMessages.reduce((sum, m) => sum + (m.tokensUsados || 0), 0);
    const currentTokens = allMessages
      .filter(m => m.criadoEm && new Date(m.criadoEm) >= weekAgo)
      .reduce((sum, m) => sum + (m.tokensUsados || 0), 0);
    const previousTokens = allMessages
      .filter(m => m.criadoEm && new Date(m.criadoEm) >= twoWeeksAgo && new Date(m.criadoEm) < weekAgo)
      .reduce((sum, m) => sum + (m.tokensUsados || 0), 0);

    const calcTrend = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    res.json({
      conversations: allConversations.length,
      documents: allDocuments.length,
      trainingData: allTraining.length,
      tokensUsed: totalTokens,
      trend: {
        conversations: calcTrend(currentConversations, previousConversations),
        documents: calcTrend(currentDocuments, previousDocuments),
        trainingData: calcTrend(currentTraining, previousTraining),
        tokensUsed: calcTrend(currentTokens, previousTokens),
      },
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar estatísticas');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/usage', async (_req: Request, res: Response) => {
  try {
    const today = new Date();
    const usageData = [];

    const allConversations = await db.query.conversations.findMany();
    const allMessages = await db.query.messages.findMany();
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));
      const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

      const dayConversations = allConversations.filter(c => 
        c.criadoEm && new Date(c.criadoEm) >= startOfDay && new Date(c.criadoEm) <= endOfDay
      ).length;

      const dayMessages = allMessages.filter(m =>
        m.criadoEm && new Date(m.criadoEm) >= startOfDay && new Date(m.criadoEm) <= endOfDay
      );
      const dayTokens = dayMessages.reduce((sum, m) => sum + (m.tokensUsados || 0), 0);
      
      usageData.push({
        date: dateStr,
        conversations: dayConversations,
        tokens: dayTokens,
      });
    }
    
    res.json(usageData);
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar dados de uso');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/conversations', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('chat:conversations:read'), async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  
  if (!userId) {
    return res.status(401).json({ error: 'ID do usuário necessário' });
  }

  try {
    const conversations = await db.query.conversations.findMany({
      where: eq(schema.conversations.userId, userId),
      orderBy: [desc(schema.conversations.atualizadoEm)],
      limit: 50,
    });

    res.json({ conversations });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar conversas');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const createConversationSchema = z.object({
  agentId: z.string().uuid().optional(),
  namespaceId: z.string().uuid().optional(),
  titulo: z.string().optional(),
});

app.post('/api/chat/conversations', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('chat:conversations:write'), async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  
  if (!userId) {
    return res.status(401).json({ error: 'ID do usuário necessário' });
  }

  try {
    const body = createConversationSchema.parse(req.body);

    const [conversation] = await db.insert(schema.conversations).values({
      userId,
      agentId: body.agentId,
      namespaceId: body.namespaceId,
      titulo: body.titulo || 'Nova Conversa',
    }).returning();

    logger.info({ conversationId: conversation.id, userId }, 'Conversa criada');
    res.json({ conversation });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar conversa');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/conversations/:id/messages', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('chat:messages:read'), async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const messages = await db.query.messages.findMany({
      where: eq(schema.messages.conversationId, id),
      orderBy: [schema.messages.criadoEm],
    });

    res.json({ messages });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar mensagens');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const sendMessageSchema = z.object({
  conteudo: z.string().min(1),
  tipo: z.enum(['text', 'image', 'audio', 'video', 'document', 'mixed']).default('text'),
});

app.post('/api/chat/conversations/:id/messages', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('chat:messages:write'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.headers['x-user-id'] as string;

  try {
    const body = sendMessageSchema.parse(req.body);

    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, id),
      with: { agent: true },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const [userMessage] = await db.insert(schema.messages).values({
      conversationId: id,
      userId,
      conteudo: body.conteudo,
      tipo: body.tipo,
      isFromUser: true,
    }).returning();

    const agent = conversation.agent as { instrucoes?: string } | null;
    let systemPrompt = agent?.instrucoes || 'Você é Alice, uma assistente de IA empresarial inteligente e útil. Responda sempre em português.';
    
    const ragStartTime = Date.now();
    const ragResult = await buscarContextoRAG(body.conteudo, conversation.namespaceId || undefined);
    const ragLatency = Date.now() - ragStartTime;
    
    if (ragResult && ragResult.context) {
      systemPrompt += formatarContextoParaLLM(ragResult);
      logger.info({ 
        conversationId: id, 
        ragChunks: ragResult.sources.length,
        ragLatencyMs: ragLatency,
      }, 'Contexto RAG injetado no prompt');
    }
    
    const previousMessages = await db.query.messages.findMany({
      where: eq(schema.messages.conversationId, id),
      orderBy: [desc(schema.messages.criadoEm)],
      limit: 10,
    });

    const llmMessages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...previousMessages.reverse().map(m => ({
        role: (m.isFromUser ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.conteudo || '',
      })),
    ];

    const llmStartTime = Date.now();
    const response = await callLlamaAPI(llmMessages);
    const llmLatency = Date.now() - llmStartTime;
    const totalLatency = Date.now() - ragStartTime;

    const [assistantMessage] = await db.insert(schema.messages).values({
      conversationId: id,
      agentId: conversation.agentId,
      conteudo: response as string,
      tipo: 'text',
      isFromUser: false,
      latenciaMs: totalLatency,
    }).returning();

    await db.update(schema.conversations)
      .set({ 
        totalMensagens: (conversation.totalMensagens || 0) + 2,
        ultimaMensagemEm: new Date(),
        atualizadoEm: new Date(),
      })
      .where(eq(schema.conversations.id, id));

    logger.info({ 
      conversationId: id, 
      ragLatencyMs: ragLatency,
      llmLatencyMs: llmLatency,
      totalLatencyMs: totalLatency,
      usedRag: !!ragResult?.context,
    }, 'Mensagem processada com integração RAG');
    
    res.json({ 
      userMessage, 
      assistantMessage,
      ragSources: ragResult?.sources || [],
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao enviar mensagem');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/chat/stream', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('chat:messages:write'), async (req: Request, res: Response) => {
  const { messages: inputMessages, conversationId, namespaceId } = req.body as { 
    messages: Array<{ role: string; content: string }>;
    conversationId?: string;
    namespaceId?: string;
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    let systemPrompt = 'Você é Alice, uma assistente de IA empresarial inteligente e útil. Responda sempre em português.';
    
    const lastUserMessage = inputMessages.filter(m => m.role === 'user').pop();
    let ragSources: Array<{ documentId: string; titulo: string; similarity: number }> = [];
    
    if (lastUserMessage) {
      const ragResult = await buscarContextoRAG(lastUserMessage.content, namespaceId);
      if (ragResult && ragResult.context) {
        systemPrompt += formatarContextoParaLLM(ragResult);
        ragSources = ragResult.sources;
        logger.info({ 
          ragChunks: ragResult.sources.length,
          namespaceId,
        }, 'Contexto RAG injetado no streaming');
      }
    }
    
    const llmMessages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...inputMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    if (ragSources.length > 0) {
      res.write(`data: ${JSON.stringify({ type: 'sources', sources: ragSources })}\n\n`);
    }

    const stream = await callLlamaAPI(llmMessages, true) as AsyncGenerator<string>;

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    logger.error({ error }, 'Erro no streaming');
    res.write(`data: ${JSON.stringify({ error: 'Erro ao processar mensagem' })}\n\n`);
    res.end();
  }
});

const wsClients = new Map<string, WebSocket>();

wss.on('connection', (ws, req) => {
  const urlParams = new URL(req.url || '', 'ws://localhost').searchParams;
  const userId = urlParams.get('userId');
  
  if (!userId) {
    ws.close(4001, 'ID do usuário necessário');
    return;
  }

  wsClients.set(userId, ws);
  logger.info({ userId }, 'Cliente WebSocket conectado');

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString()) as {
        type: string;
        conversationId: string;
        content: string;
        namespaceId?: string;
      };

      if (message.type === 'chat') {
        const ragStartTime = Date.now();
        
        const [userMsg] = await db.insert(schema.messages).values({
          conversationId: message.conversationId,
          userId,
          conteudo: message.content,
          tipo: 'text',
          isFromUser: true,
        }).returning();

        ws.send(JSON.stringify({ type: 'message', data: userMsg }));

        const conversation = await db.query.conversations.findFirst({
          where: eq(schema.conversations.id, message.conversationId),
          with: { agent: true },
        });

        const agent = conversation?.agent as { instrucoes?: string } | null;
        let systemPrompt = agent?.instrucoes || 'Você é Alice, uma assistente de IA empresarial.';

        const namespaceId = message.namespaceId || conversation?.namespaceId || undefined;
        const ragResult = await buscarContextoRAG(message.content, namespaceId);
        const ragLatency = Date.now() - ragStartTime;
        
        if (ragResult && ragResult.context) {
          systemPrompt += formatarContextoParaLLM(ragResult);
          
          ws.send(JSON.stringify({ 
            type: 'sources', 
            data: ragResult.sources,
            ragLatencyMs: ragLatency,
          }));
          
          logger.info({ 
            conversationId: message.conversationId,
            ragChunks: ragResult.sources.length,
            ragLatencyMs: ragLatency,
            namespaceId,
          }, 'Contexto RAG injetado via WebSocket');
        }

        const llmStartTime = Date.now();
        const stream = await callLlamaAPI([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message.content },
        ], true) as AsyncGenerator<string>;

        let fullResponse = '';
        for await (const chunk of stream) {
          fullResponse += chunk;
          ws.send(JSON.stringify({ type: 'stream', data: chunk }));
        }
        const llmLatency = Date.now() - llmStartTime;
        const totalLatency = Date.now() - ragStartTime;

        const [assistantMsg] = await db.insert(schema.messages).values({
          conversationId: message.conversationId,
          agentId: conversation?.agentId,
          conteudo: fullResponse,
          tipo: 'text',
          isFromUser: false,
          latenciaMs: totalLatency,
        }).returning();

        ws.send(JSON.stringify({ 
          type: 'complete', 
          data: assistantMsg,
          metrics: {
            ragLatencyMs: ragLatency,
            llmLatencyMs: llmLatency,
            totalLatencyMs: totalLatency,
            usedRag: !!ragResult?.context,
            ragChunks: ragResult?.sources?.length || 0,
          },
        }));
        
        logger.info({
          conversationId: message.conversationId,
          ragLatencyMs: ragLatency,
          llmLatencyMs: llmLatency,
          totalLatencyMs: totalLatency,
          usedRag: !!ragResult?.context,
        }, 'Mensagem WebSocket processada com integração RAG');
      }
    } catch (error) {
      logger.error({ error }, 'Erro na mensagem WebSocket');
      ws.send(JSON.stringify({ type: 'error', error: 'Falha ao processar mensagem' }));
    }
  });

  ws.on('close', () => {
    wsClients.delete(userId);
    logger.info({ userId }, 'Cliente WebSocket desconectado');
  });
});

// ============================================================================
// TAKEOVER/HANDOVER ROUTES (FASE 6.5)
// ============================================================================

app.get('/api/chat/conversations/:id/state', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('chat:takeover:read'), async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    const state = await getOrCreateConversationState(id);
    res.json({ state });
  } catch (error) {
    logger.error({ error, conversationId: id }, 'Erro ao buscar estado da conversa');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/chat/conversations/:id/takeover', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('chat:takeover:write'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const agentId = req.headers['x-user-id'] as string;
  const { notes } = req.body as { notes?: string };
  
  if (!agentId) {
    return res.status(401).json({ error: 'ID do agente necessário' });
  }
  
  try {
    const result = await inititateTakeover(id, agentId, notes);
    
    if (result.success) {
      res.json({ 
        message: 'Takeover realizado com sucesso',
        ...result,
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    logger.error({ error, conversationId: id, agentId }, 'Erro ao realizar takeover');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/chat/conversations/:id/handback', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('chat:handoff:write'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const agentId = req.headers['x-user-id'] as string;
  const { resolutionNotes } = req.body as { resolutionNotes?: string };
  
  if (!agentId) {
    return res.status(401).json({ error: 'ID do agente necessário' });
  }
  
  try {
    const result = await handbackToBot(id, agentId, resolutionNotes);
    
    if (result.success) {
      res.json({ 
        message: 'Controle devolvido para IA com sucesso',
        ...result,
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    logger.error({ error, conversationId: id, agentId }, 'Erro ao devolver controle para IA');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/pending-handoffs', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('chat:takeover:read'), async (_req: Request, res: Response) => {
  try {
    const pending = await getPendingHandoffs();
    res.json({ pending, count: pending.length });
  } catch (error) {
    logger.error({ error }, 'Erro ao listar handoffs pendentes');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/takeover/conversations', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('chat:takeover:read'), async (req: Request, res: Response) => {
  const { status, channel, priority } = req.query as { 
    status?: string; 
    channel?: string; 
    priority?: string;
  };
  
  try {
    const allConversations = await db.query.conversations.findMany({
      with: {
        messages: {
          orderBy: [desc(schema.messages.criadoEm)],
          limit: 1,
        },
        user: true,
      },
      orderBy: [desc(schema.conversations.ultimaMensagemEm)],
    });
    
    const allStates = await db.query.conversationStates.findMany();
    const statesMap = new Map(allStates.map(s => [s.conversationId, s]));
    
    let conversations = allConversations.map(conv => {
      const state = statesMap.get(conv.id);
      const lastMessage = conv.messages?.[0];
      
      let slaStatus: 'ok' | 'at_risk' | 'breached' = 'ok';
      if (state?.slaBreached) {
        slaStatus = 'breached';
      } else if (state?.slaDeadline) {
        const deadline = new Date(state.slaDeadline);
        const now = new Date();
        const minutesRemaining = (deadline.getTime() - now.getTime()) / 60000;
        if (minutesRemaining < 10) slaStatus = 'at_risk';
      }
      
      let calculatedPriority: 'high' | 'medium' | 'low' = 'medium';
      if (state?.slaBreached || slaStatus === 'at_risk') {
        calculatedPriority = 'high';
      } else if ((state?.sentimentScore ?? 0) < -0.3) {
        calculatedPriority = 'high';
      }
      
      const metadata = conv.metadata as { canal?: string } | null;
      
      return {
        id: conv.id,
        titulo: conv.titulo,
        userId: conv.userId,
        canal: metadata?.canal || 'web',
        status: state?.controlMode || 'bot',
        assignedAgentId: state?.assignedAgentId,
        confidenceScore: state?.confidenceScore,
        sentimentScore: state?.sentimentScore,
        fallbackCount: state?.fallbackCount,
        slaDeadline: state?.slaDeadline,
        slaBreached: state?.slaBreached,
        slaStatus,
        priority: calculatedPriority,
        pendingSince: state?.pendingSince,
        ultimaMensagemEm: conv.ultimaMensagemEm,
        totalMensagens: conv.totalMensagens,
        lastMessage: lastMessage ? {
          conteudo: lastMessage.conteudo,
          isFromUser: lastMessage.isFromUser,
          criadoEm: lastMessage.criadoEm,
        } : null,
        user: conv.user ? {
          id: conv.user.id,
          email: conv.user.email,
          firstName: conv.user.firstName,
          lastName: conv.user.lastName,
        } : null,
      };
    });
    
    const summary = {
      pending: conversations.filter(c => c.status === 'pending_handoff').length,
      human: conversations.filter(c => c.status === 'human').length,
      bot: conversations.filter(c => c.status === 'bot').length,
      slaBreached: conversations.filter(c => c.slaBreached).length,
      atRisk: conversations.filter(c => c.slaStatus === 'at_risk').length,
    };
    
    if (status && status !== 'all') {
      conversations = conversations.filter(c => c.status === status);
    }
    if (channel && channel !== 'all') {
      conversations = conversations.filter(c => c.canal === channel);
    }
    if (priority && priority !== 'all') {
      conversations = conversations.filter(c => c.priority === priority);
    }
    
    res.json({ 
      conversations,
      total: conversations.length,
      summary,
    });
  } catch (error) {
    logger.error({ error }, 'Erro ao listar conversas para takeover');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/takeover/conversations/:id/message', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('chat:takeover:write'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const agentId = req.headers['x-user-id'] as string;
  const { content } = req.body as { content: string };
  
  if (!agentId) {
    return res.status(401).json({ error: 'ID do agente necessário' });
  }
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Conteúdo da mensagem necessário' });
  }
  
  try {
    const state = await getOrCreateConversationState(id);
    
    if (state.controlMode !== 'human') {
      return res.status(400).json({ 
        error: 'Conversa não está em modo humano. Faça takeover primeiro.',
        currentMode: state.controlMode,
      });
    }
    
    if (state.assignedAgentId !== agentId) {
      return res.status(403).json({ 
        error: 'Você não é o agente atribuído a esta conversa',
        assignedAgentId: state.assignedAgentId,
      });
    }
    
    const [message] = await db.insert(schema.messages).values({
      conversationId: id,
      userId: agentId,
      conteudo: content.trim(),
      tipo: 'text',
      isFromUser: false,
    }).returning();
    
    await db.update(schema.conversations)
      .set({
        ultimaMensagemEm: new Date(),
        atualizadoEm: new Date(),
      })
      .where(eq(schema.conversations.id, id));
    
    logger.info({ conversationId: id, agentId, messageId: message.id }, 'Mensagem humana enviada');
    
    res.json({ 
      message,
      success: true,
    });
  } catch (error) {
    logger.error({ error, conversationId: id, agentId }, 'Erro ao enviar mensagem humana');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/urgent-conversations', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('chat:takeover:read'), async (req: Request, res: Response) => {
  const minutesThreshold = parseInt(req.query.minutes as string) || 10;
  
  try {
    const urgent = await getUrgentConversations(minutesThreshold);
    res.json({ urgent, count: urgent.length });
  } catch (error) {
    logger.error({ error }, 'Erro ao listar conversas urgentes');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/chat/check-sla', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('chat:escalation:manage'), async (_req: Request, res: Response) => {
  try {
    const breachedCount = await checkSLABreaches();
    res.json({ breachedCount, message: `${breachedCount} SLAs violados processados` });
  } catch (error) {
    logger.error({ error }, 'Erro ao verificar SLAs');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/escalation-config', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('chat:escalation:read'), (_req: Request, res: Response) => {
  res.json(ESCALATION_CONFIG);
});

// ============================================================================
// IMAGE GENERATION ROUTES (FASE 6.5+)
// ============================================================================

const imageGenerationSchema = z.object({
  prompt: z.string().min(1).max(2000),
  negativePrompt: z.string().max(1000).optional(),
  width: z.number().min(256).max(2048).default(1024),
  height: z.number().min(256).max(2048).default(1024),
  steps: z.number().min(1).max(50).default(4),
  seed: z.number().optional(),
  guidanceScale: z.number().min(1).max(20).default(3.5),
});

app.post('/api/chat/images/generate', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('images:generate:write'), async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  const tenantId = req.headers['x-tenant-id'] as string;
  
  try {
    const body = imageGenerationSchema.parse(req.body);
    
    const result = await generateImage(body, {
      tenantId,
      createdBy: userId,
      conversationId: req.body.conversationId,
      messageId: req.body.messageId,
    });
    
    res.json({
      imageId: result.imageId,
      generationTimeMs: result.generationTimeMs,
      imageBase64: result.imageBase64,
    });
  } catch (error) {
    logger.error({ error }, 'Erro ao gerar imagem');
    res.status(500).json({ error: 'Erro ao gerar imagem' });
  }
});

app.post('/api/chat/images/:id/rate', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('images:generate:write'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const tenantId = req.headers['x-tenant-id'] as string;
  const { score } = req.body as { score: number };
  
  try {
    const image = await db.query.generatedImages.findFirst({
      where: eq(schema.generatedImages.id, id),
    });
    
    if (!image || image.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }
    
    await rateImage(id, score);
    res.json({ message: 'Feedback registrado com sucesso' });
  } catch (error) {
    logger.error({ error, imageId: id }, 'Erro ao registrar feedback');
    res.status(500).json({ error: 'Erro ao registrar feedback' });
  }
});

app.post('/api/chat/images/:id/approve', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('images:approve:write'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const tenantId = req.headers['x-tenant-id'] as string;
  const { approved } = req.body as { approved: boolean };
  
  try {
    const image = await db.query.generatedImages.findFirst({
      where: eq(schema.generatedImages.id, id),
    });
    
    if (!image || image.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }
    
    await approveForTraining(id, approved);
    res.json({ message: `Imagem ${approved ? 'aprovada' : 'reprovada'} para treinamento` });
  } catch (error) {
    logger.error({ error, imageId: id }, 'Erro ao aprovar imagem');
    res.status(500).json({ error: 'Erro ao aprovar imagem' });
  }
});

app.get('/api/chat/images/stats', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('images:generate:read'), async (_req: Request, res: Response) => {
  try {
    const stats = await getImageGenerationStats();
    const breakerStats = getImageGenBreakerStats();
    res.json({ ...stats, circuitBreaker: breakerStats });
  } catch (error) {
    logger.error({ error }, 'Erro ao buscar estatísticas de imagens');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/images', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('images:generate:read'), async (req: Request, res: Response) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  const { status, approved, limit, offset } = req.query;
  
  if (!tenantId) {
    return res.status(400).json({ error: 'Tenant ID obrigatório' });
  }
  
  try {
    let images = await db.query.generatedImages.findMany({
      where: eq(schema.generatedImages.tenantId, tenantId),
      orderBy: [desc(schema.generatedImages.criadoEm)],
      with: {
        conversation: true,
      },
    });
    
    if (status && status !== 'all') {
      images = images.filter(img => img.status === status);
    }
    
    if (approved === 'true') {
      images = images.filter(img => img.approvedForTraining === true);
    } else if (approved === 'false') {
      images = images.filter(img => img.approvedForTraining === false);
    } else if (approved === 'pending') {
      images = images.filter(img => img.approvedForTraining === null);
    }
    
    const total = images.length;
    
    const pageOffset = parseInt(offset as string) || 0;
    const pageLimit = parseInt(limit as string) || 20;
    images = images.slice(pageOffset, pageOffset + pageLimit);
    
    res.json({
      images,
      total,
      offset: pageOffset,
      limit: pageLimit,
    });
  } catch (error) {
    logger.error({ error }, 'Erro ao listar imagens');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/images/:id', requireAuth, requireSameTenant(getTenantIdFromRequest), requirePermission('images:generate:read'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const tenantId = req.headers['x-tenant-id'] as string;
  
  try {
    const image = await db.query.generatedImages.findFirst({
      where: eq(schema.generatedImages.id, id),
      with: {
        conversation: true,
      },
    });
    
    if (!image) {
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }
    
    if (image.tenantId !== tenantId) {
      logger.warn({ imageId: id, requestedBy: tenantId, ownedBy: image.tenantId }, 'Tentativa de acesso a imagem de outro tenant');
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }
    
    res.json({ image });
  } catch (error) {
    logger.error({ error, imageId: id }, 'Erro ao buscar imagem');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const errorHandler = (err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err }, 'Erro não tratado');
  res.status(500).json({ error: 'Erro interno do servidor' });
};

app.use(errorHandler);

server.listen(PORT, () => {
  logger.info({ 
    port: PORT, 
    llmConfigured: !!SALAD_API_KEY,
    circuitBreaker: 'enabled',
  }, 'Chat service iniciado com Circuit Breaker');
});

process.on('SIGTERM', () => {
  logger.info('Encerrando chat service');
  wss.close();
  server.close();
  process.exit(0);
});
