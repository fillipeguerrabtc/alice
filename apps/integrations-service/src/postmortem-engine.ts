/**
 * Post-Mortem Engine - Análise automática pós-trade (Two-Phase: CPU + LLM)
 * 
 * Fluxo:
 * 1. Phase 1 (CPU - Determinístico): Classificação de trade style, archetype, technique scores, evidence pack
 * 2. Phase 2 (LLM - Explicativo): Motivadores, fatores de sucesso/falha, lições aprendidas
 * 
 * Position-centric: Post-mortem roda no fechamento de POSIÇÃO (não de ordem individual)
 * Idempotência: fingerprint SHA256 garante que mesmo position+fills gera mesmo post-mortem
 * 
 * @author Fillipe Guerra
 * @since 09/02/2026
 */

import { createHash } from 'node:crypto';
import { createLogger } from '@alice/logger';
import { getDatabase, schema } from '@alice/database';
import { eq, and, desc } from '@alice/database';
import {
  requestGpu,
  GpuServiceType,
  GpuRequestPriority,
  getRedisClient,
} from '@alice/shared-utils';
import { callGatewayComplete, isGatewayConfigured } from './llm-gateway-client.js';
import type { TradingTechnique, TradingTechniqueScore } from '@alice/shared';
import { TradingTechniqueSchema } from '@alice/shared';
import { calculateTechniqueScores } from './technical-indicators.js';
import type { TechnicalAnalysisResult } from './technical-indicators.js';
import { getSnapshot, saveEvidencePack } from './snapshot-store.js';
import type { EvidencePack } from './snapshot-store.js';
import { resolveModelWithAdapter } from './lora-adapter-resolver.js';
import { queryPostMortemRAGContext, indexPostMortemLearnings } from './trading-rag-client.js';

const logger = createLogger('postmortem-engine');

// ============================================================================
// Constantes e versões
// ============================================================================

/** Versões dos engines para rastreabilidade nos datasets */
export const ENGINE_VERSIONS = {
  postmortem: 'v1.0.0',
  evidence: 'v1.0.0',
  executionModel: 'v1.0.0',
} as const;

/** Timeout para requisição LLM Phase 2 (ms) */
const LLM_POSTMORTEM_TIMEOUT_MS = 120_000;

/** Quota diária de chamadas LLM por tenant (Phase 2 postmortem) */
const LLM_DAILY_QUOTA_PER_TENANT = 50;

/** Chave Redis para contabilizar chamadas LLM por tenant/dia */
const QUOTA_KEY_PREFIX = 'alice:postmortem:llm_quota:';

// ============================================================================
// Quotas de Custo LLM
// ============================================================================

/**
 * Verifica se tenant tem quota disponível para chamada LLM.
 * Usa Redis com TTL de 24h para contabilização diária.
 */
async function checkAndIncrementLlmQuota(tenantId: string): Promise<{ allowed: boolean; used: number; limit: number }> {
  const redis = getRedisClient();
  if (!redis) {
    // Se Redis não disponível, permitir (fail-open para não bloquear operação)
    logger.warn({ tenantId }, 'Redis indisponível para verificar quota LLM — permitindo');
    return { allowed: true, used: 0, limit: LLM_DAILY_QUOTA_PER_TENANT };
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `${QUOTA_KEY_PREFIX}${tenantId}:${today}`;

  const current = await redis.incr(key);
  // Definir TTL apenas na primeira vez (quando incr retorna 1)
  if (current === 1) {
    await redis.expire(key, 86400); // 24 horas
  }

  if (current > LLM_DAILY_QUOTA_PER_TENANT) {
    // Decrementar de volta pois não será usada
    await redis.decr(key);
    return { allowed: false, used: current - 1, limit: LLM_DAILY_QUOTA_PER_TENANT };
  }

  return { allowed: true, used: current, limit: LLM_DAILY_QUOTA_PER_TENANT };
}

// ============================================================================
// Tipos
// ============================================================================

/** Dados de posição para post-mortem (funciona tanto para real quanto demo) */
export interface PostMortemPositionData {
  id: string;
  tenantId: string;
  isDemo: boolean;
  symbol: string;
  marketType: 'spot' | 'futures' | 'margin';
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  size: number;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
  realizedPnl: number;
  totalFees: number;
  openedAt: Date;
  closedAt: Date;
  entrySnapshotId?: string;
  exitSnapshotId?: string;
}

/** Classificação Phase 1 CPU (inclui dados da posição para auditabilidade e datasets) */
export interface PostMortemClassification {
  tradeStyle: 'scalping' | 'day_trade' | 'swing' | 'position';
  archetype: string;
  strategy: string;
  techniqueScores: TradingTechniqueScore[];
  durationSec: number;
  pnlPct: number;
  // Dados da posição (para datasets e auditoria — copiados no momento da classificação)
  positionData: {
    symbol: string;
    marketType: string;
    side: string;
    leverage: number;
    entryPrice: number;
    exitPrice: number;
    size: number;
    pnl: number;
    totalFees: number;
    openedAt: string; // ISO-8601
    closedAt: string; // ISO-8601
    entrySnapshotId?: string;
    exitSnapshotId?: string;
  };
}

/** Motivador gerado pelo LLM */
export interface PostMortemMotivator {
  title: string;
  explanation: string;
  citedValues: Record<string, number | string>;
}

/** Lições aprendidas */
export interface PostMortemLessons {
  repeat: string[];
  avoid: string[];
}

/** Resultado completo do post-mortem
 * Campos de Phase 1 (classification) e Phase 2 (motivators, successFactors, failureFactors, lessons)
 * são null quando o post-mortem ainda não completou a respectiva fase.
 * Consumidores DEVEM verificar o campo `status` antes de acessar esses campos.
 */
export interface PostMortemResult {
  id: string;
  fingerprint: string;
  status: string;
  classification: PostMortemClassification | null;
  motivators: PostMortemMotivator[];
  successFactors: string[];
  failureFactors: string[];
  lessons: PostMortemLessons | null;
  engineVersions: Record<string, string>;
}

// ============================================================================
// Fingerprint (Idempotência)
// ============================================================================

/**
 * Computa fingerprint idempotente para um post-mortem
 * Garante que a mesma posição com mesmos dados gera o mesmo hash
 */
export function computeFingerprint(params: {
  positionId: string;
  entryTs: string;
  exitTs: string;
  entryPrice: number;
  exitPrice: number;
  size: number;
  engineVersions: Record<string, string>;
}): string {
  const payload = JSON.stringify({
    positionId: params.positionId,
    entryTs: params.entryTs,
    exitTs: params.exitTs,
    entryPrice: params.entryPrice,
    exitPrice: params.exitPrice,
    size: params.size,
    engineVersions: params.engineVersions,
  });
  return createHash('sha256').update(payload).digest('hex');
}

// ============================================================================
// Phase 1 - CPU (Determinístico)
// ============================================================================

/**
 * Identifica trade style baseado na duração
 */
function identifyTradeStyle(durationSec: number): 'scalping' | 'day_trade' | 'swing' | 'position' {
  if (durationSec < 15 * 60) return 'scalping'; // < 15min
  if (durationSec < 24 * 60 * 60) return 'day_trade'; // < 24h
  if (durationSec < 7 * 24 * 60 * 60) return 'swing'; // < 7 dias
  return 'position'; // >= 7 dias
}

/**
 * Identifica archetype baseado nos indicadores no momento de entrada
 */
function identifyArchetype(indicators: Record<string, unknown>): string {
  const rsi = indicators.rsi as { value?: number; interpretation?: string } | undefined;
  const adx = indicators.adx as { trendStrength?: string; plusDI?: number; minusDI?: number } | undefined;
  const bollinger = indicators.bollinger as { percentB?: number } | undefined;

  // Trend following: ADX forte + DI direcional
  if (adx?.trendStrength === 'strong' || adx?.trendStrength === 'very_strong') {
    return 'trend';
  }

  // Breakout: Bollinger %B acima de 1 ou abaixo de 0
  if (bollinger?.percentB !== undefined && (bollinger.percentB > 1 || bollinger.percentB < 0)) {
    return 'breakout';
  }

  // Mean reversion: RSI extremo
  if (rsi?.interpretation === 'oversold' || rsi?.interpretation === 'overbought') {
    return 'mean_reversion';
  }

  // Momentum como fallback quando há algum sinal direcional
  if (rsi?.value !== undefined && (rsi.value > 60 || rsi.value < 40)) {
    return 'momentum';
  }

  return 'range'; // Default: mercado sem tendência clara
}

/**
 * Identifica strategy baseada no trade style e archetype
 */
function identifyStrategy(tradeStyle: string, archetype: string, marketType: string): string {
  if (marketType === 'futures') {
    if (tradeStyle === 'scalping' && archetype === 'momentum') return 'momentum_scalp';
    if (archetype === 'trend') return 'trend_following';
    if (archetype === 'breakout') return 'breakout_trade';
    if (archetype === 'mean_reversion') return 'mean_reversion_futures';
    return 'directional_futures';
  }
  if (marketType === 'margin') {
    if (archetype === 'trend') return 'leveraged_trend';
    return 'margin_trade';
  }
  // Spot
  if (archetype === 'trend') return 'spot_trend';
  if (archetype === 'mean_reversion') return 'buy_the_dip';
  return 'spot_trade';
}

/**
 * Executa Phase 1 do post-mortem (CPU determinístico)
 * 
 * 1. Classifica trade style por duração
 * 2. Identifica archetype pelos indicadores
 * 3. Calcula technique scores
 * 4. Gera evidence pack
 */
export async function executePhase1(params: {
  position: PostMortemPositionData;
  indicators?: TechnicalAnalysisResult;
}): Promise<{
  classification: PostMortemClassification;
  evidencePackSnapshotId: string;
}> {
  const { position, indicators } = params;

  // Calcular duração
  const durationSec = Math.floor((position.closedAt.getTime() - position.openedAt.getTime()) / 1000);
  
  // Calcular PnL percentual
  const pnlPct = position.entryPrice > 0
    ? ((position.exitPrice - position.entryPrice) / position.entryPrice) * 100 * (position.side === 'long' ? 1 : -1)
    : 0;

  // Identificar trade style por duração
  const tradeStyle = identifyTradeStyle(durationSec);

  // Extrair indicadores do evidence pack se disponível
  const indicatorData: Record<string, unknown> = (indicators ?? {}) as Record<string, unknown>;
  
  // Identificar archetype e strategy
  const archetype = identifyArchetype(indicatorData);
  const strategy = identifyStrategy(tradeStyle, archetype, position.marketType);

  // Calcular technique scores para todas as técnicas relevantes
  const allTechniques = TradingTechniqueSchema.options as unknown as TradingTechnique[];
  let techniqueScores: TradingTechniqueScore[] = [];

  if (indicators) {
    techniqueScores = calculateTechniqueScores({
      analysis: indicators,
      techniques: allTechniques,
    });
  }

  const classification: PostMortemClassification = {
    tradeStyle,
    archetype,
    strategy,
    techniqueScores,
    durationSec,
    pnlPct,
    positionData: {
      symbol: position.symbol,
      marketType: position.marketType,
      side: position.side,
      leverage: position.leverage,
      entryPrice: position.entryPrice,
      exitPrice: position.exitPrice,
      size: position.size,
      pnl: position.realizedPnl,
      totalFees: position.totalFees,
      openedAt: position.openedAt.toISOString(),
      closedAt: position.closedAt.toISOString(),
      entrySnapshotId: position.entrySnapshotId,
      exitSnapshotId: position.exitSnapshotId,
    },
  };

  // Gerar Evidence Pack e salvar como snapshot
  const evidencePack: EvidencePack = {
    entrySnapshotId: position.entrySnapshotId ?? '',
    exitSnapshotId: position.exitSnapshotId ?? '',
    indicators: indicatorData as Record<string, unknown>,
    capturedAt: new Date().toISOString(),
  };

  const evidenceSnapshot = await saveEvidencePack({
    tenantId: position.tenantId,
    positionId: position.id,
    evidencePack,
  });

  logger.info({
    positionId: position.id,
    tradeStyle,
    archetype,
    strategy,
    durationSec,
    pnlPct: pnlPct.toFixed(2),
    techniqueScoresCount: techniqueScores.length,
  }, 'Phase 1 CPU concluída com sucesso');

  return {
    classification,
    evidencePackSnapshotId: evidenceSnapshot.id,
  };
}

// ============================================================================
// Phase 2 - LLM (Explicativo)
// ============================================================================

/**
 * Monta prompt para o LLM gerar motivadores e lições
 */
function buildLLMPrompt(params: {
  position: PostMortemPositionData;
  classification: PostMortemClassification;
  evidencePack: EvidencePack;
  ragContext?: string;
}): Array<{ role: string; content: string }> {
  const { position, classification, evidencePack, ragContext } = params;

  const ragSection = ragContext
    ? `\nCONHECIMENTO DE TRADES ANTERIORES (RAG):\n${ragContext}\nUse esses learnings para contextualizar sua análise quando relevante.`
    : '';

  const systemPrompt = `Você é um analista de trading sênior especializado em criptomoedas. 
Sua tarefa é analisar uma operação de trading finalizada e gerar insights acionáveis.
${ragSection}
REGRAS OBRIGATÓRIAS:
1. Cada motivador DEVE citar valores numéricos específicos em "citedValues" (ex: RSI, preço, volume)
2. Os valores citados DEVEM existir no Evidence Pack fornecido
3. Respostas devem ser em português brasileiro
4. Não invente dados - use APENAS valores do contexto fornecido

Responda EXCLUSIVAMENTE em JSON válido com o schema abaixo.`;

  const userPrompt = `## Contexto da Operação

**Símbolo:** ${position.symbol}
**Mercado:** ${position.marketType}
**Lado:** ${position.side}
**Alavancagem:** ${position.leverage}x
**Preço de Entrada:** ${position.entryPrice}
**Preço de Saída:** ${position.exitPrice}
**PnL:** ${classification.pnlPct.toFixed(2)}%
**Duração:** ${classification.durationSec}s (${identifyTradeStyle(classification.durationSec)})
**Fees:** ${position.totalFees}

## Classificação Automática (Phase 1)
**Trade Style:** ${classification.tradeStyle}
**Archetype:** ${classification.archetype}
**Strategy:** ${classification.strategy}

## Indicadores Técnicos (Evidence Pack)
${JSON.stringify(evidencePack.indicators, null, 2)}

## Top Technique Scores
${classification.techniqueScores
  .sort((a, b) => b.confidence - a.confidence)
  .slice(0, 5)
  .map(t => `- ${t.technique}: ${(t.confidence * 100).toFixed(0)}% - ${t.rationale ?? 'sem rationale'}`)
  .join('\n')}

## Responda no seguinte JSON schema:
{
  "motivators": [
    {
      "title": "string (título curto do motivador)",
      "explanation": "string (explicação detalhada em 1-2 frases)",
      "citedValues": { "indicador": valor_numerico }
    }
  ],
  "successFactors": ["string (fator que contribuiu para o resultado)"],
  "failureFactors": ["string (fator que prejudicou ou poderia melhorar)"],
  "lessons": {
    "repeat": ["string (ação a repetir em trades futuros)"],
    "avoid": ["string (ação a evitar em trades futuros)"]
  }
}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

/**
 * Executa Phase 2 do post-mortem (LLM explicativo)
 * 
 * Envia classificação + evidence pack ao LLM para gerar:
 * - Motivadores com citedValues
 * - Fatores de sucesso/falha
 * - Lições aprendidas
 */
export async function executePhase2(params: {
  position: PostMortemPositionData;
  classification: PostMortemClassification;
  evidencePackSnapshotId: string;
  userId?: string;
  namespaceId?: string | null;
  agentId?: string | null;
}): Promise<{
  motivators: PostMortemMotivator[];
  successFactors: string[];
  failureFactors: string[];
  lessons: PostMortemLessons;
}> {
  const { position, classification, evidencePackSnapshotId } = params;

  // Buscar evidence pack do snapshot
  const evidenceSnapshot = await getSnapshot(evidencePackSnapshotId);
  const evidencePack = (evidenceSnapshot?.data ?? {
    entrySnapshotId: '',
    exitSnapshotId: '',
    indicators: {},
    capturedAt: new Date().toISOString(),
  }) as unknown as EvidencePack;

  // Buscar contexto RAG para enriquecer post-mortem com learnings anteriores
  let ragContext: string | undefined;
  if (params.userId && params.namespaceId) {
    const ragResult = await queryPostMortemRAGContext({
      tenantId: position.tenantId,
      userId: params.userId,
      namespaceId: params.namespaceId,
      symbol: position.symbol,
      tradeStyle: classification.tradeStyle,
      archetype: classification.archetype,
      pnlPct: classification.pnlPct,
    });
    ragContext = ragResult?.context;
  }

  // Montar prompt (com contexto RAG se disponível)
  const messages = buildLLMPrompt({ position, classification, evidencePack, ragContext });

  logger.info({ positionId: position.id }, 'Iniciando Phase 2 LLM para post-mortem');

  try {
    // Resolver modelo com adapter LoRA ativo (se disponível)
    // Post-mortem usa adapter treinado para gerar motivadores mais precisos
    const baseModel = 'Qwen/Qwen2.5-7B-Instruct-AWQ';
    if (!params.namespaceId || !params.agentId) {
      throw new Error('trading_scope_required: namespace/agente trading obrigatório para post-mortem');
    }
    const resolvedModel = await resolveModelWithAdapter(baseModel, {
      tenantId: position.tenantId,
      namespaceId: params.namespaceId ?? undefined,
      agentId: params.agentId ?? undefined,
    });
    if (resolvedModel === baseModel) {
      throw new Error('trading_scope_required: adaptador LoRA de Trading obrigatório para post-mortem');
    }

    logger.info({
      positionId: position.id,
      model: resolvedModel,
      usingLoraAdapter: resolvedModel !== baseModel,
      viaGateway: isGatewayConfigured(),
    }, 'Modelo resolvido para Phase 2 LLM do post-mortem');

    const gpuResponse = isGatewayConfigured()
      ? await callGatewayComplete({
          messages: messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
          config: { model: resolvedModel, temperature: 0.7, maxTokens: 2048 },
          context: {
            route: '/trading',
            tenantId: position.tenantId,
            userId: params.userId,
            namespaceId: params.namespaceId ?? undefined,
            agentId: params.agentId ?? undefined,
          },
          requestOptions: { timeout: LLM_POSTMORTEM_TIMEOUT_MS, priority: 'low' },
        })
      : await requestGpu({
          serviceType: GpuServiceType.LLM,
          endpoint: '/v1/chat/completions',
          method: 'POST',
          priority: GpuRequestPriority.LOW,
          timeout: LLM_POSTMORTEM_TIMEOUT_MS,
          body: {
            model: resolvedModel,
            messages,
            max_tokens: 2048,
            temperature: 0.7,
            stream: false,
          },
        });

    if (!gpuResponse.success || !gpuResponse.data) {
      throw new Error(gpuResponse.error || 'Falha na resposta do GPU Manager para post-mortem');
    }

    // Extrair resposta do LLM
    const llmData = gpuResponse.data as { choices?: Array<{ message?: { content?: string } }> };
    const rawContent = llmData.choices?.[0]?.message?.content ?? '';

    // Parsear JSON da resposta
    let parsed: {
      motivators?: PostMortemMotivator[];
      successFactors?: string[];
      failureFactors?: string[];
      lessons?: PostMortemLessons;
    };

    try {
      // Tentar extrair JSON da resposta (pode vir com markdown code blocks)
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Resposta LLM não contém JSON válido');
      }
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      logger.warn({ rawContent: rawContent.substring(0, 500), error: parseError }, 'Falha ao parsear resposta LLM - usando defaults');
      parsed = {};
    }

    const result = {
      motivators: Array.isArray(parsed.motivators) ? parsed.motivators : [],
      successFactors: Array.isArray(parsed.successFactors) ? parsed.successFactors : [],
      failureFactors: Array.isArray(parsed.failureFactors) ? parsed.failureFactors : [],
      lessons: {
        repeat: Array.isArray(parsed.lessons?.repeat) ? parsed.lessons.repeat : [],
        avoid: Array.isArray(parsed.lessons?.avoid) ? parsed.lessons.avoid : [],
      },
    };

    logger.info({
      positionId: position.id,
      motivatorsCount: result.motivators.length,
      successFactorsCount: result.successFactors.length,
      failureFactorsCount: result.failureFactors.length,
    }, 'Phase 2 LLM concluída com sucesso');

    return result;
  } catch (error) {
    logger.error({ error, positionId: position.id }, 'Erro na Phase 2 LLM do post-mortem');
    throw error;
  }
}

// ============================================================================
// Helper: Resolver namespace trading do tenant
// ============================================================================

/**
 * Busca o namespaceId do agente trading ativo para um tenant.
 * Usado para enriquecer post-mortems com contexto RAG.
 * Retorna null se não encontrado (não bloqueante).
 */
async function resolveTradingNamespaceId(tenantId: string): Promise<string | null> {
  try {
    const db = getDatabase();
    const tradingNamespace = await db.query.namespaces.findFirst({
      where: and(
        eq(schema.namespaces.tenantId, tenantId),
        eq(schema.namespaces.slug, 'trading'),
        eq(schema.namespaces.ativo, true)
      ),
    });
    return tradingNamespace?.id ?? null;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), tenantId },
      'Falha ao resolver namespace trading para post-mortem RAG (continuando sem RAG)'
    );
    return null;
  }
}

/**
 * Busca o agente Trading ativo mais recente de um namespace.
 * Retorna null quando não existe agente ativo vinculado ao namespace.
 */
async function resolveTradingAgentId(tenantId: string, namespaceId: string): Promise<string | null> {
  try {
    const db = getDatabase();
    const agent = await db.query.agents.findFirst({
      where: and(
        eq(schema.agents.tenantId, tenantId),
        eq(schema.agents.namespaceId, namespaceId),
        eq(schema.agents.status, 'active')
      ),
      orderBy: [desc(schema.agents.atualizadoEm)],
      columns: { id: true },
    });
    return agent?.id ?? null;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), tenantId, namespaceId },
      'Falha ao resolver agente trading para post-mortem'
    );
    return null;
  }
}

/**
 * Busca o primeiro userId disponível para o tenant.
 * Usado como fallback quando userId não é fornecido nos chamadores de post-mortem.
 */
async function resolveTenantUserId(tenantId: string): Promise<string | null> {
  try {
    const db = getDatabase();
    const user = await db.query.users.findFirst({
      where: eq(schema.users.tenantId, tenantId),
      orderBy: [desc(schema.users.createdAt)],
    });
    return user?.id ?? null;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), tenantId },
      'Falha ao resolver userId para post-mortem RAG (continuando sem RAG)'
    );
    return null;
  }
}

// ============================================================================
// Orquestração Completa
// ============================================================================

/**
 * Executa post-mortem completo (Phase 1 + Phase 2)
 * Cria registro no banco e atualiza status progressivamente
 */
export async function executePostMortem(params: {
  position: PostMortemPositionData;
  indicators?: TechnicalAnalysisResult;
  userId?: string;
  namespaceId?: string | null;
}): Promise<PostMortemResult> {
  const { position, indicators } = params;
  const db = getDatabase();

  // Resolver userId e namespaceId para RAG (se não fornecidos)
  // Busca automática garante que post-mortems enfileirados sem contexto
  // (ex: demo-trading-engine) ainda consigam usar RAG
  const userId = params.userId ?? await resolveTenantUserId(position.tenantId);
  const namespaceId = params.namespaceId !== undefined ? params.namespaceId : await resolveTradingNamespaceId(position.tenantId);
  if (!namespaceId) {
    throw new Error('trading_scope_required: namespace trading obrigatório para post-mortem');
  }
  const agentId = await resolveTradingAgentId(position.tenantId, namespaceId);
  if (!agentId) {
    throw new Error('trading_scope_required: agente trading ativo obrigatório para post-mortem');
  }

  // Computar fingerprint para idempotência
  const fingerprint = computeFingerprint({
    positionId: position.id,
    entryTs: position.openedAt.toISOString(),
    exitTs: position.closedAt.toISOString(),
    entryPrice: position.entryPrice,
    exitPrice: position.exitPrice,
    size: position.size,
    engineVersions: { ...ENGINE_VERSIONS },
  });

  // Verificar se já existe post-mortem com este fingerprint (idempotência)
  const [existing] = await db
    .select()
    .from(schema.tradingPostmortems)
    .where(eq(schema.tradingPostmortems.fingerprint, fingerprint))
    .limit(1);

  if (existing) {
    logger.info({ fingerprint, positionId: position.id, status: existing.status }, 'Post-mortem já existe (idempotência) - retornando existente');
    return {
      id: existing.id,
      fingerprint: existing.fingerprint,
      status: existing.status,
      classification: existing.classification
        ? (existing.classification as unknown as PostMortemClassification)
        : null,
      motivators: Array.isArray(existing.motivators)
        ? (existing.motivators as unknown as PostMortemMotivator[])
        : [],
      successFactors: Array.isArray(existing.successFactors)
        ? (existing.successFactors as unknown as string[])
        : [],
      failureFactors: Array.isArray(existing.failureFactors)
        ? (existing.failureFactors as unknown as string[])
        : [],
      lessons: existing.lessons
        ? (existing.lessons as unknown as PostMortemLessons)
        : null,
      engineVersions: existing.engineVersions,
    };
  }

  // Criar registro com status queued
  const [postmortem] = await db
    .insert(schema.tradingPostmortems)
    .values({
      tenantId: position.tenantId,
      positionId: position.id,
      isDemo: position.isDemo,
      fingerprint,
      status: 'queued',
      engineVersions: { ...ENGINE_VERSIONS },
    })
    .returning();

  try {
    // Phase 1: CPU
    await db
      .update(schema.tradingPostmortems)
      .set({ status: 'processing_cpu' })
      .where(eq(schema.tradingPostmortems.id, postmortem.id));

    const phase1Result = await executePhase1({ position, indicators });

    await db
      .update(schema.tradingPostmortems)
      .set({
        status: 'completed_cpu',
        classification: phase1Result.classification as unknown as Record<string, unknown>,
        evidencePackSnapshotId: phase1Result.evidencePackSnapshotId,
      })
      .where(eq(schema.tradingPostmortems.id, postmortem.id));

    // Phase 2: LLM (com verificação de quota)
    const quota = await checkAndIncrementLlmQuota(position.tenantId);
    if (!quota.allowed) {
      logger.warn({
        tenantId: position.tenantId,
        used: quota.used,
        limit: quota.limit,
        postmortemId: postmortem.id,
      }, 'Quota diária de LLM excedida — Phase 2 pulada, post-mortem ficará em completed_cpu');

      // Manter status completed_cpu sem executar Phase 2
      return {
        id: postmortem.id,
        fingerprint,
        status: 'completed_cpu',
        classification: phase1Result.classification,
        motivators: [],
        successFactors: [],
        failureFactors: [],
        lessons: { repeat: [], avoid: [] },
        engineVersions: { ...ENGINE_VERSIONS },
      };
    }

    await db
      .update(schema.tradingPostmortems)
      .set({ status: 'processing_llm' })
      .where(eq(schema.tradingPostmortems.id, postmortem.id));

    const phase2Result = await executePhase2({
      position,
      classification: phase1Result.classification,
      evidencePackSnapshotId: phase1Result.evidencePackSnapshotId,
      userId: userId ?? undefined,
      namespaceId,
      agentId,
    });

    // Marcar como completo
    await db
      .update(schema.tradingPostmortems)
      .set({
        status: 'completed',
        motivators: phase2Result.motivators as unknown as unknown[],
        successFactors: phase2Result.successFactors as unknown as unknown[],
        failureFactors: phase2Result.failureFactors as unknown as unknown[],
        lessons: phase2Result.lessons as unknown as Record<string, unknown>,
        completedAt: new Date(),
      })
      .where(eq(schema.tradingPostmortems.id, postmortem.id));

    logger.info({ postmortemId: postmortem.id, positionId: position.id }, 'Post-mortem completo (Phase 1 + Phase 2)');

    // Feedback loop: Indexar learnings no RAG para futuras gerações de sinais e post-mortems
    // Não bloqueante - falhas são logadas mas não afetam o resultado do post-mortem
    if (userId && namespaceId) {
      indexPostMortemLearnings({
        tenantId: position.tenantId,
        userId,
        namespaceId,
        learning: {
          postmortemId: postmortem.id,
          symbol: position.symbol,
          marketType: position.marketType,
          tradeStyle: phase1Result.classification.tradeStyle,
          archetype: phase1Result.classification.archetype,
          strategy: phase1Result.classification.strategy,
          side: position.side,
          pnlPct: phase1Result.classification.pnlPct,
          realizedPnl: position.realizedPnl,
          leverage: position.leverage,
          durationSec: phase1Result.classification.durationSec,
          motivators: phase2Result.motivators,
          successFactors: phase2Result.successFactors,
          failureFactors: phase2Result.failureFactors,
          lessons: phase2Result.lessons,
          closedAt: position.closedAt.toISOString(),
        },
      }).catch((err: unknown) => {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err), postmortemId: postmortem.id },
          'Falha no feedback loop RAG (não bloqueante)'
        );
      });
    }

    return {
      id: postmortem.id,
      fingerprint,
      status: 'completed',
      classification: phase1Result.classification,
      motivators: phase2Result.motivators,
      successFactors: phase2Result.successFactors,
      failureFactors: phase2Result.failureFactors,
      lessons: phase2Result.lessons,
      engineVersions: { ...ENGINE_VERSIONS },
    };
  } catch (error) {
    // Marcar como falho
    const errorMessage = error instanceof Error ? error.message : String(error);
    await db
      .update(schema.tradingPostmortems)
      .set({
        status: 'failed',
        errorMessage,
        retryCount: postmortem.retryCount + 1,
      })
      .where(eq(schema.tradingPostmortems.id, postmortem.id));

    logger.error({ error, postmortemId: postmortem.id }, 'Falha no post-mortem');
    throw error;
  }
}
