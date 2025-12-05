/**
 * Conversation Orchestrator - Alice Enterprise Platform
 * 
 * Gerencia takeover/handover de conversas entre IA e agentes humanos.
 * Implementa triggers automáticos baseados em pesquisa 2025:
 * - Confiança < 70%
 * - 3+ fallbacks consecutivos
 * - Sentimento negativo
 * - Keywords de escalação
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { eq, and, isNull, lt, desc } from '@alice/database';
import pino from 'pino';
import * as schema from '@alice/shared/schema';
import type { Database } from '@alice/database';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ module: 'conversation-orchestrator' });

let db: Database;

export function initOrchestrator(dbClient: Database): void {
  db = dbClient;
  logger.info('Conversation orchestrator inicializado com conexão compartilhada');
}

// ============================================================================
// CONFIGURAÇÕES DE ESCALAÇÃO (Best Practices 2025)
// ============================================================================

const ESCALATION_CONFIG = {
  confidenceThreshold: 0.7,      // Escalar se confiança < 70%
  fallbackCountThreshold: 3,     // Escalar após 3 fallbacks
  sentimentThreshold: -0.3,      // Escalar se sentimento < -0.3
  slaMinutes: 30,                // SLA default: 30 minutos
  escalationKeywords: [
    'falar com humano',
    'atendente',
    'pessoa real',
    'supervisor',
    'gerente',
    'reclamação',
    'não entende',
    'não ajuda',
    'cancelar',
    'reembolso',
  ],
  // Frases que indicam baixa confiança do LLM (indicadores proxy)
  lowConfidenceIndicators: [
    'não tenho certeza',
    'não sei',
    'não consigo',
    'não posso ajudar',
    'não tenho informação',
    'não disponho',
    'desculpe, mas',
    'infelizmente não',
    'fora do meu escopo',
    'preciso de mais contexto',
    'não compreendi',
    'poderia reformular',
    'não entendi',
    'não é possível',
    'sugiro que entre em contato',
    'recomendo falar com',
  ],
} as const;

// ============================================================================
// TYPES
// ============================================================================

type ConversationControlMode = 'bot' | 'human' | 'pending_handoff' | 'hybrid';
type EscalationTrigger = 'low_confidence' | 'fallback_count' | 'negative_sentiment' | 'keyword_match' | 'manual_request' | 'sla_breach';

interface EscalationContext {
  conversationId: string;
  trigger: EscalationTrigger;
  confidence?: number;
  sentiment?: number;
  fallbackCount?: number;
  triggerDetails?: Record<string, unknown>;
}

interface HandoffResult {
  success: boolean;
  newMode: ConversationControlMode;
  assignedAgentId?: string;
  error?: string;
}

interface ConversationStateUpdate {
  controlMode?: ConversationControlMode;
  assignedAgentId?: string | null;
  confidenceScore?: number;
  fallbackCount?: number;
  sentimentScore?: number;
  notes?: string;
}

// ============================================================================
// FUNÇÕES DE ANÁLISE
// ============================================================================

/**
 * Detecta keywords de escalação na mensagem
 */
export function detectEscalationKeywords(message: string): boolean {
  const lowerMessage = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  return ESCALATION_CONFIG.escalationKeywords.some(keyword => {
    const normalizedKeyword = keyword.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return lowerMessage.includes(normalizedKeyword);
  });
}

/**
 * Analisa resposta do LLM para detectar indicadores de baixa confiança
 * Retorna confidence score estimado baseado em indicadores proxy
 * 
 * Usado para incrementar fallback counter quando LLM dá respostas evasivas
 * (Llama 4 não retorna confidence score diretamente)
 */
export function analyzeLLMResponseConfidence(llmResponse: string): {
  estimatedConfidence: number;
  isLowConfidence: boolean;
  matchedIndicators: string[];
} {
  const lowerResponse = llmResponse.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  const matchedIndicators: string[] = [];
  
  for (const indicator of ESCALATION_CONFIG.lowConfidenceIndicators) {
    const normalizedIndicator = indicator.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (lowerResponse.includes(normalizedIndicator)) {
      matchedIndicators.push(indicator);
    }
  }
  
  // Calcular confidence estimada: começa em 1.0 e decresce 0.15 por cada indicador
  const confidencePenalty = matchedIndicators.length * 0.15;
  const estimatedConfidence = Math.max(0, 1 - confidencePenalty);
  
  return {
    estimatedConfidence,
    isLowConfidence: estimatedConfidence < ESCALATION_CONFIG.confidenceThreshold,
    matchedIndicators,
  };
}

/**
 * Processa resposta do LLM e atualiza estado da conversa
 * Se resposta indica baixa confiança, incrementa fallback counter
 * 
 * @returns EscalationContext se deve escalar após esta resposta, null caso contrário
 */
export async function processLLMResponseForEscalation(
  conversationId: string,
  llmResponse: string
): Promise<EscalationContext | null> {
  const analysis = analyzeLLMResponseConfidence(llmResponse);
  
  if (analysis.isLowConfidence) {
    const state = await getOrCreateConversationState(conversationId);
    const newFallbackCount = (state.fallbackCount || 0) + 1;
    
    await updateConversationState(conversationId, {
      fallbackCount: newFallbackCount,
      confidenceScore: analysis.estimatedConfidence,
    });
    
    logger.info({
      conversationId,
      estimatedConfidence: analysis.estimatedConfidence,
      matchedIndicators: analysis.matchedIndicators,
      fallbackCount: newFallbackCount,
    }, 'Resposta do LLM com baixa confiança detectada');
    
    // Verificar se atingiu threshold de fallback para escalar
    if (newFallbackCount >= ESCALATION_CONFIG.fallbackCountThreshold) {
      return {
        conversationId,
        trigger: 'low_confidence',  // Trigger correto: baixa confiança acumulada
        confidence: analysis.estimatedConfidence,
        fallbackCount: newFallbackCount,
        triggerDetails: {
          matchedIndicators: analysis.matchedIndicators,
          estimatedConfidence: analysis.estimatedConfidence,
          reason: 'Múltiplas respostas consecutivas com indicadores de incerteza do LLM',
        },
      };
    }
  } else {
    // Resposta de alta confiança - resetar fallback counter
    await updateConversationState(conversationId, {
      fallbackCount: 0,
      confidenceScore: analysis.estimatedConfidence,
    });
  }
  
  return null;
}

/**
 * Analisa sentimento básico da mensagem
 * Retorna valor entre -1 (negativo) e 1 (positivo)
 */
export function analyzeSentiment(message: string): number {
  const negativeWords = [
    'ruim', 'péssimo', 'horrível', 'odeio', 'raiva', 'frustrado', 'frustração',
    'irritado', 'irritação', 'problema', 'erro', 'falha', 'não funciona',
    'terrível', 'inútil', 'incompetente', 'absurdo', 'vergonha',
  ];
  
  const positiveWords = [
    'bom', 'ótimo', 'excelente', 'obrigado', 'agradeço', 'perfeito',
    'maravilhoso', 'incrível', 'fantástico', 'satisfeito', 'contente',
  ];
  
  const lowerMessage = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  let score = 0;
  const words = lowerMessage.split(/\s+/);
  
  for (const word of words) {
    if (negativeWords.some(neg => word.includes(neg))) {
      score -= 0.2;
    }
    if (positiveWords.some(pos => word.includes(pos))) {
      score += 0.2;
    }
  }
  
  return Math.max(-1, Math.min(1, score));
}

// ============================================================================
// GERENCIAMENTO DE ESTADO
// ============================================================================

/**
 * Obtém ou cria o estado de uma conversa
 */
export async function getOrCreateConversationState(conversationId: string) {
  let state = await db.query.conversationStates.findFirst({
    where: eq(schema.conversationStates.conversationId, conversationId),
  });
  
  if (!state) {
    const [newState] = await db.insert(schema.conversationStates).values({
      conversationId,
      controlMode: 'bot',
      fallbackCount: 0,
    }).returning();
    state = newState;
    logger.info({ conversationId }, 'Estado de conversa criado');
  }
  
  return state;
}

/**
 * Atualiza o estado de uma conversa
 */
export async function updateConversationState(
  conversationId: string,
  updates: ConversationStateUpdate
) {
  const [updated] = await db.update(schema.conversationStates)
    .set({
      ...updates,
      atualizadoEm: new Date(),
    })
    .where(eq(schema.conversationStates.conversationId, conversationId))
    .returning();
  
  logger.info({ conversationId, updates }, 'Estado de conversa atualizado');
  return updated;
}

/**
 * Verifica se uma mensagem deve trigger escalação automática
 */
export async function shouldEscalate(
  conversationId: string,
  message: string,
  confidence?: number
): Promise<EscalationContext | null> {
  const state = await getOrCreateConversationState(conversationId);
  
  if (state.controlMode === 'human' || state.controlMode === 'pending_handoff') {
    return null;
  }
  
  if (detectEscalationKeywords(message)) {
    return {
      conversationId,
      trigger: 'keyword_match',
      triggerDetails: { message },
    };
  }
  
  const sentiment = analyzeSentiment(message);
  await updateConversationState(conversationId, { sentimentScore: sentiment });
  
  if (sentiment < ESCALATION_CONFIG.sentimentThreshold) {
    return {
      conversationId,
      trigger: 'negative_sentiment',
      sentiment,
      triggerDetails: { sentiment },
    };
  }
  
  if (confidence !== undefined) {
    await updateConversationState(conversationId, { confidenceScore: confidence });
    
    if (confidence < ESCALATION_CONFIG.confidenceThreshold) {
      return {
        conversationId,
        trigger: 'low_confidence',
        confidence,
        triggerDetails: { confidence },
      };
    }
  }
  
  const currentFallbackCount = (state.fallbackCount || 0) + 1;
  
  if (currentFallbackCount >= ESCALATION_CONFIG.fallbackCountThreshold) {
    return {
      conversationId,
      trigger: 'fallback_count',
      fallbackCount: currentFallbackCount,
      triggerDetails: { fallbackCount: currentFallbackCount },
    };
  }
  
  return null;
}

// ============================================================================
// TAKEOVER / HANDOFF
// ============================================================================

/**
 * Inicia takeover por agente humano
 */
export async function inititateTakeover(
  conversationId: string,
  agentId: string,
  notes?: string
): Promise<HandoffResult> {
  try {
    const state = await getOrCreateConversationState(conversationId);
    
    await db.insert(schema.conversationEscalations).values({
      conversationId,
      trigger: 'manual_request',
      fromMode: state.controlMode || 'bot',
      toMode: 'human',
      handledBy: agentId,
      confidenceAtEscalation: state.confidenceScore,
      sentimentAtEscalation: state.sentimentScore,
      fallbackCountAtEscalation: state.fallbackCount,
      triggerDetails: { initiatedBy: 'agent', notes },
    });
    
    await updateConversationState(conversationId, {
      controlMode: 'human',
      assignedAgentId: agentId,
      notes,
    });
    
    await db.insert(schema.conversationParticipants).values({
      conversationId,
      userId: agentId,
      role: 'agent',
      isActive: true,
    });
    
    logger.info({ conversationId, agentId }, 'Takeover iniciado por agente');
    
    return {
      success: true,
      newMode: 'human',
      assignedAgentId: agentId,
    };
  } catch (error) {
    logger.error({ error, conversationId, agentId }, 'Erro ao iniciar takeover');
    return {
      success: false,
      newMode: 'bot',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}

/**
 * Processa escalação automática
 */
export async function processAutoEscalation(
  context: EscalationContext
): Promise<HandoffResult> {
  try {
    const state = await getOrCreateConversationState(context.conversationId);
    
    await db.insert(schema.conversationEscalations).values({
      conversationId: context.conversationId,
      trigger: context.trigger,
      fromMode: state.controlMode || 'bot',
      toMode: 'pending_handoff',
      confidenceAtEscalation: context.confidence ?? state.confidenceScore,
      sentimentAtEscalation: context.sentiment ?? state.sentimentScore,
      fallbackCountAtEscalation: context.fallbackCount ?? state.fallbackCount,
      triggerDetails: context.triggerDetails,
    });
    
    const slaDeadline = new Date();
    slaDeadline.setMinutes(slaDeadline.getMinutes() + ESCALATION_CONFIG.slaMinutes);
    
    await updateConversationState(context.conversationId, {
      controlMode: 'pending_handoff',
    });
    
    await db.update(schema.conversationStates)
      .set({
        pendingSince: new Date(),
        slaDeadline,
      })
      .where(eq(schema.conversationStates.conversationId, context.conversationId));
    
    logger.warn({ 
      conversationId: context.conversationId, 
      trigger: context.trigger,
      slaDeadline,
    }, 'Escalação automática processada - aguardando agente humano');
    
    return {
      success: true,
      newMode: 'pending_handoff',
    };
  } catch (error) {
    logger.error({ error, context }, 'Erro ao processar escalação automática');
    return {
      success: false,
      newMode: 'bot',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}

/**
 * Devolve controle para a IA (handback)
 */
export async function handbackToBot(
  conversationId: string,
  agentId: string,
  resolutionNotes?: string
): Promise<HandoffResult> {
  try {
    const state = await getOrCreateConversationState(conversationId);
    
    const [escalation] = await db.select()
      .from(schema.conversationEscalations)
      .where(
        and(
          eq(schema.conversationEscalations.conversationId, conversationId),
          isNull(schema.conversationEscalations.resolvedAt)
        )
      )
      .orderBy(desc(schema.conversationEscalations.criadoEm))
      .limit(1);
    
    if (escalation) {
      await db.update(schema.conversationEscalations)
        .set({
          resolvedAt: new Date(),
          resolutionNotes,
          handledBy: agentId,
        })
        .where(eq(schema.conversationEscalations.id, escalation.id));
    }
    
    await db.update(schema.conversationParticipants)
      .set({
        leftAt: new Date(),
        isActive: false,
      })
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          eq(schema.conversationParticipants.userId, agentId)
        )
      );
    
    await updateConversationState(conversationId, {
      controlMode: 'bot',
      assignedAgentId: null,
      notes: resolutionNotes,
    });
    
    await db.update(schema.conversationStates)
      .set({
        pendingSince: null,
        slaDeadline: null,
        slaBreached: false,
        fallbackCount: 0,
      })
      .where(eq(schema.conversationStates.conversationId, conversationId));
    
    logger.info({ conversationId, agentId, resolutionNotes }, 'Controle devolvido para IA');
    
    return {
      success: true,
      newMode: 'bot',
    };
  } catch (error) {
    logger.error({ error, conversationId, agentId }, 'Erro ao devolver controle para IA');
    return {
      success: false,
      newMode: 'human',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}

// ============================================================================
// QUERIES PARA DASHBOARD
// ============================================================================

/**
 * Lista conversas pendentes de handoff
 */
export async function getPendingHandoffs(tenantId?: string) {
  const states = await db.query.conversationStates.findMany({
    where: eq(schema.conversationStates.controlMode, 'pending_handoff'),
  });
  
  return states;
}

/**
 * Lista conversas com SLA próximo de expirar
 */
export async function getUrgentConversations(minutesThreshold = 10) {
  const threshold = new Date();
  threshold.setMinutes(threshold.getMinutes() + minutesThreshold);
  
  const states = await db.query.conversationStates.findMany({
    where: and(
      eq(schema.conversationStates.controlMode, 'pending_handoff'),
      lt(schema.conversationStates.slaDeadline, threshold)
    ),
  });
  
  return states;
}

/**
 * Incrementa contador de fallbacks
 */
export async function incrementFallbackCount(conversationId: string): Promise<number> {
  const state = await getOrCreateConversationState(conversationId);
  const newCount = (state.fallbackCount || 0) + 1;
  
  await updateConversationState(conversationId, {
    fallbackCount: newCount,
  });
  
  return newCount;
}

/**
 * Verifica e marca SLAs violados
 */
export async function checkSLABreaches() {
  const now = new Date();
  
  const breached = await db.update(schema.conversationStates)
    .set({ slaBreached: true, atualizadoEm: now })
    .where(
      and(
        eq(schema.conversationStates.controlMode, 'pending_handoff'),
        eq(schema.conversationStates.slaBreached, false),
        lt(schema.conversationStates.slaDeadline, now)
      )
    )
    .returning();
  
  if (breached.length > 0) {
    logger.warn({ count: breached.length }, 'SLAs violados detectados');
    
    for (const state of breached) {
      await db.insert(schema.conversationEscalations).values({
        conversationId: state.conversationId,
        trigger: 'sla_breach',
        fromMode: 'pending_handoff',
        toMode: 'pending_handoff',
        triggerDetails: { slaDeadline: state.slaDeadline, breachedAt: now },
      });
    }
  }
  
  return breached.length;
}

export { ESCALATION_CONFIG };
