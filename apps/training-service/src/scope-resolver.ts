import { createLogger } from '@alice/logger';
import { getDatabase, schema, and, eq } from '@alice/database';
import { getSystemConfig } from '@alice/database/system-config';

const logger = createLogger('training-scope-resolver');

const LOW_CONFIDENCE_THRESHOLD_DEFAULT = 0.65;

export interface ScopeResolverInput {
  tenantId: string;
  namespaceId?: string | null;
  agentId?: string | null;
  domain?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
  conversationId?: string | null;
  messagesText?: string | null;
}

export interface SuggestedNewNamespace {
  name: string;
  theme: string;
}

export interface ScopeResolution {
  namespaceId: string | null;
  agentId: string | null;
  domain: string | null;
  confidence: number;
  trace: Record<string, unknown>;
  needsHumanReview: boolean;
  /** Sugestão para criar novo namespace quando não houver match. */
  suggestedNewNamespace?: SuggestedNewNamespace | null;
}

interface TraceStep {
  step: string;
  matched: boolean;
  confidence?: number;
  detail?: Record<string, unknown>;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveLowConfidenceThreshold(): Promise<number> {
  const configured = await getSystemConfig('TRAINING_SCOPE_LOW_CONFIDENCE_THRESHOLD');
  if (!configured) return LOW_CONFIDENCE_THRESHOLD_DEFAULT;
  const parsed = Number(configured);
  if (!Number.isFinite(parsed)) return LOW_CONFIDENCE_THRESHOLD_DEFAULT;
  return Math.min(1, Math.max(0, parsed));
}

function readKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function inferDomainByHeuristicText(text: string): { domain: string; confidence: number; detail: Record<string, unknown> } {
  const tradingTerms = [
    'trading',
    'trade',
    'market',
    'mercado',
    'futures',
    'spot',
    'btc',
    'eth',
    'alavancagem',
    'leverage',
    'stop loss',
    'take profit',
    'candles',
    'order book',
    'kucoin',
    'binance',
    'derivativos',
  ];
  const matchedTerms = tradingTerms.filter((term) => text.includes(term));
  if (matchedTerms.length > 0) {
    return {
      domain: 'trading-geral',
      confidence: Math.min(0.62, 0.45 + matchedTerms.length * 0.03),
      detail: {
        reason: 'heuristic_trading_fallback',
        matchedTerms: matchedTerms.slice(0, 10),
      },
    };
  }

  return {
    domain: 'geral',
    confidence: 0.4,
    detail: {
      reason: 'heuristic_general_fallback',
    },
  };
}

async function inferDomainFromProfiles(input: ScopeResolverInput, rawText: string): Promise<{ domain: string | null; confidence: number; detail: Record<string, unknown> }> {
  const text = normalizeText(rawText);
  if (!text) return { domain: null, confidence: 0, detail: { reason: 'empty_text' } };

  const db = getDatabase();
  let profiles: Array<{
    id: string;
    domain: string;
    namespaceId: string | null;
    agentId: string | null;
    keywords: unknown;
    exclusions: unknown;
  }> = [];
  try {
    profiles = await db.query.trainingDatasetProfiles.findMany({
      where: and(
        eq(schema.trainingDatasetProfiles.tenantId, input.tenantId),
        eq(schema.trainingDatasetProfiles.isActive, true)
      ),
      columns: {
        id: true,
        domain: true,
        namespaceId: true,
        agentId: true,
        keywords: true,
        exclusions: true,
      },
    });
  } catch (error) {
    logger.warn(
      {
        tenantId: input.tenantId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Falha ao consultar trainingDatasetProfiles para inferência de domínio'
    );
    const heuristic = inferDomainByHeuristicText(text);
    return {
      domain: heuristic.domain,
      confidence: heuristic.confidence,
      detail: {
        reason: 'profiles_lookup_failed',
        ...heuristic.detail,
      },
    };
  }

  if (profiles.length === 0) {
    const heuristic = inferDomainByHeuristicText(text);
    return {
      domain: heuristic.domain,
      confidence: heuristic.confidence,
      detail: {
        reason: 'no_active_profiles',
        ...heuristic.detail,
      },
    };
  }

  const ranked = profiles.map((profile) => {
    const keywords = readKeywords(profile.keywords);
    const exclusions = readKeywords(profile.exclusions);
    const keywordHits = keywords.filter((term) => text.includes(normalizeText(term))).length;
    const exclusionHits = exclusions.filter((term) => text.includes(normalizeText(term))).length;
    const relationBoost = (
      (input.namespaceId && profile.namespaceId === input.namespaceId ? 0.15 : 0) +
      (input.agentId && profile.agentId === input.agentId ? 0.15 : 0)
    );
    const rawScore = Math.max(0, keywordHits - exclusionHits * 0.75) + relationBoost;
    const confidence = rawScore > 0 ? Math.min(0.95, 0.35 + rawScore * 0.1) : 0;
    return {
      profileId: profile.id,
      domain: profile.domain,
      keywordHits,
      exclusionHits,
      relationBoost,
      rawScore,
      confidence,
    };
  });

  ranked.sort((a, b) => b.rawScore - a.rawScore);
  const winner = ranked[0];
  if (!winner || winner.rawScore <= 0) {
    const heuristic = inferDomainByHeuristicText(text);
    return {
      domain: heuristic.domain,
      confidence: heuristic.confidence,
      detail: {
        reason: 'no_keyword_match',
        ...heuristic.detail,
      },
    };
  }

  return {
    domain: winner.domain,
    confidence: winner.confidence,
    detail: {
      profileId: winner.profileId,
      keywordHits: winner.keywordHits,
      exclusionHits: winner.exclusionHits,
      relationBoost: winner.relationBoost,
    },
  };
}

function readString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = meta?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function resolveByConversation(
  tenantId: string,
  conversationId: string
): Promise<{ namespaceId: string | null; agentId: string | null; detail: Record<string, unknown> } | null> {
  const db = getDatabase();
  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(schema.conversations.id, conversationId),
      eq(schema.conversations.tenantId, tenantId)
    ),
    columns: {
      id: true,
      namespaceId: true,
      agentId: true,
    },
  });

  if (!conversation) return null;
  return {
    namespaceId: conversation.namespaceId ?? null,
    agentId: conversation.agentId ?? null,
    detail: { conversationId: conversation.id },
  };
}

async function resolveBySourceRelationship(
  input: ScopeResolverInput
): Promise<{ namespaceId: string | null; agentId: string | null; detail: Record<string, unknown> } | null> {
  const db = getDatabase();
  if (!input.sourceId || !input.sourceType) return null;

  if (input.sourceType === 'document' || input.sourceType === 'rag_document') {
    const document = await db.query.documents.findFirst({
      where: eq(schema.documents.id, input.sourceId),
      columns: { id: true, namespaceId: true, metadata: true },
    });

    if (!document) return null;
    const metadata = (document.metadata ?? {}) as Record<string, unknown>;
    return {
      namespaceId: document.namespaceId ?? null,
      agentId: readString(metadata, 'agentId'),
      detail: { documentId: document.id, strategy: 'document_lookup' },
    };
  }

  if (input.sourceType === 'trading_signal') {
    const signal = await db.query.tradingSignals.findFirst({
      where: and(
        eq(schema.tradingSignals.id, input.sourceId),
        eq(schema.tradingSignals.tenantId, input.tenantId)
      ),
      columns: { id: true, metadata: true },
    });

    if (!signal) return null;
    const metadata = (signal.metadata ?? {}) as Record<string, unknown>;
    return {
      namespaceId: readString(metadata, 'namespaceId'),
      agentId: readString(metadata, 'agentId'),
      detail: { signalId: signal.id, strategy: 'signal_metadata' },
    };
  }

  if (input.sourceType === 'trading_order') {
    const order = await db.query.tradingOrders.findFirst({
      where: and(
        eq(schema.tradingOrders.id, input.sourceId),
        eq(schema.tradingOrders.tenantId, input.tenantId)
      ),
      columns: { id: true, signalId: true },
    });
    if (!order?.signalId) return null;
    const signal = await db.query.tradingSignals.findFirst({
      where: and(
        eq(schema.tradingSignals.id, order.signalId),
        eq(schema.tradingSignals.tenantId, input.tenantId)
      ),
      columns: { metadata: true },
    });
    if (!signal) return null;
    const metadata = (signal.metadata ?? {}) as Record<string, unknown>;
    return {
      namespaceId: readString(metadata, 'namespaceId'),
      agentId: readString(metadata, 'agentId'),
      detail: { orderId: order.id, signalId: order.signalId, strategy: 'order_to_signal' },
    };
  }

  return null;
}

async function enforceTenantConsistency(
  tenantId: string,
  namespaceId: string | null,
  agentId: string | null
): Promise<{ namespaceId: string | null; agentId: string | null; consistency: string }> {
  const db = getDatabase();
  let resolvedNamespace = namespaceId;
  let resolvedAgent = agentId;

  if (resolvedNamespace) {
    const namespace = await db.query.namespaces.findFirst({
      where: and(
        eq(schema.namespaces.id, resolvedNamespace),
        eq(schema.namespaces.tenantId, tenantId)
      ),
      columns: { id: true },
    });
    if (!namespace) {
      resolvedNamespace = null;
      resolvedAgent = null;
      return { namespaceId: null, agentId: null, consistency: 'invalid_namespace_tenant_mismatch' };
    }
  }

  if (resolvedAgent) {
    const agent = await db.query.agents.findFirst({
      where: and(
        eq(schema.agents.id, resolvedAgent),
        eq(schema.agents.tenantId, tenantId)
      ),
      columns: { id: true, namespaceId: true },
    });
    if (!agent) {
      return { namespaceId: resolvedNamespace, agentId: null, consistency: 'invalid_agent_tenant_mismatch' };
    }
    if (!resolvedNamespace && agent.namespaceId) {
      resolvedNamespace = agent.namespaceId;
      return { namespaceId: resolvedNamespace, agentId: resolvedAgent, consistency: 'agent_namespace_backfill' };
    }
    if (resolvedNamespace && agent.namespaceId && agent.namespaceId !== resolvedNamespace) {
      return { namespaceId: resolvedNamespace, agentId: null, consistency: 'agent_namespace_conflict' };
    }
  }

  return { namespaceId: resolvedNamespace, agentId: resolvedAgent, consistency: 'ok' };
}

export async function resolveScope(input: ScopeResolverInput): Promise<ScopeResolution> {
  const steps: TraceStep[] = [];
  let namespaceId: string | null = input.namespaceId ?? null;
  let agentId: string | null = input.agentId ?? null;
  let domain: string | null = input.domain ?? null;
  let confidence = 0;

  // 1) Determinístico por input direto
  if (namespaceId) {
    confidence = Math.max(confidence, 0.98);
    steps.push({ step: 'direct_namespace', matched: true, confidence, detail: { namespaceId } });
  } else {
    steps.push({ step: 'direct_namespace', matched: false });
  }
  if (agentId) {
    confidence = Math.max(confidence, 0.98);
    steps.push({ step: 'direct_agent', matched: true, confidence, detail: { agentId } });
  } else {
    steps.push({ step: 'direct_agent', matched: false });
  }

  const metadataNamespace = readString(input.sourceMetadata ?? null, 'namespaceId');
  const metadataAgent = readString(input.sourceMetadata ?? null, 'agentId');
  const metadataDomain = readString(input.sourceMetadata ?? null, 'domain');

  if (!namespaceId && metadataNamespace) {
    namespaceId = metadataNamespace;
    confidence = Math.max(confidence, 0.92);
    steps.push({
      step: 'metadata_namespace',
      matched: true,
      confidence,
      detail: { namespaceId: metadataNamespace },
    });
  } else {
    steps.push({ step: 'metadata_namespace', matched: false });
  }

  if (!agentId && metadataAgent) {
    agentId = metadataAgent;
    confidence = Math.max(confidence, 0.9);
    steps.push({ step: 'metadata_agent', matched: true, confidence, detail: { agentId: metadataAgent } });
  } else {
    steps.push({ step: 'metadata_agent', matched: false });
  }

  if (!domain && metadataDomain) {
    domain = metadataDomain;
    confidence = Math.max(confidence, 0.85);
    steps.push({ step: 'metadata_domain', matched: true, confidence, detail: { domain } });
  } else {
    steps.push({ step: 'metadata_domain', matched: false });
  }

  // 2) Relacionamento por conversation
  if ((!namespaceId || !agentId) && input.conversationId) {
    const conversationScope = await resolveByConversation(input.tenantId, input.conversationId);
    if (conversationScope) {
      namespaceId = namespaceId ?? conversationScope.namespaceId;
      agentId = agentId ?? conversationScope.agentId;
      confidence = Math.max(confidence, 0.88);
      steps.push({
        step: 'conversation_relationship',
        matched: true,
        confidence,
        detail: conversationScope.detail,
      });
    } else {
      steps.push({ step: 'conversation_relationship', matched: false });
    }
  } else {
    steps.push({ step: 'conversation_relationship', matched: false });
  }

  // 3) Relacionamento por sourceType/sourceId
  if ((!namespaceId || !agentId) && input.sourceType && input.sourceId) {
    const relationScope = await resolveBySourceRelationship(input);
    if (relationScope) {
      namespaceId = namespaceId ?? relationScope.namespaceId;
      agentId = agentId ?? relationScope.agentId;
      confidence = Math.max(confidence, 0.84);
      steps.push({
        step: 'source_relationship',
        matched: true,
        confidence,
        detail: relationScope.detail,
      });
    } else {
      steps.push({ step: 'source_relationship', matched: false });
    }
  } else {
    steps.push({ step: 'source_relationship', matched: false });
  }

  // 4) Classificação semântica para domínio
  if (!domain) {
    const semanticText = [input.messagesText ?? '', JSON.stringify(input.sourceMetadata ?? {})]
      .filter(Boolean)
      .join('\n');
    const domainInference = await inferDomainFromProfiles(input, semanticText);
    domain = domainInference.domain;
    confidence = Math.max(confidence, domainInference.confidence);
    steps.push({
      step: 'semantic_domain_classifier',
      matched: domainInference.domain !== null,
      confidence: domainInference.confidence,
      detail: { domain: domainInference.domain, ...domainInference.detail },
    });
  } else {
    steps.push({ step: 'semantic_domain_classifier', matched: false });
  }

  // 5) Consistência multi-tenant
  const consistency = await enforceTenantConsistency(input.tenantId, namespaceId, agentId);
  namespaceId = consistency.namespaceId;
  agentId = consistency.agentId;
  if (consistency.consistency !== 'ok') {
    confidence = Math.min(confidence, 0.55);
  }
  steps.push({
    step: 'tenant_consistency',
    matched: consistency.consistency === 'ok',
    confidence,
    detail: { consistency: consistency.consistency, namespaceId, agentId },
  });

  const lowConfidenceThreshold = await resolveLowConfidenceThreshold();
  const needsHumanReview = !namespaceId || confidence < lowConfidenceThreshold;

  let suggestedNewNamespace: SuggestedNewNamespace | null = null;
  if (!namespaceId && (domain || (input.messagesText ?? '').trim().length > 0)) {
    const normalizedDomain = (domain ?? 'conhecimento').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    const name = normalizedDomain.length > 0 ? normalizedDomain : 'conhecimento';
    const theme = domain
      ? (domain.toLowerCase().includes('trading')
          ? `Domínio sugerido: Trading (${domain})`
          : `Domínio sugerido: ${domain}`)
      : 'Domínio não identificado';
    suggestedNewNamespace = { name, theme };
  }

  const trace: Record<string, unknown> = {
    steps,
    tenantId: input.tenantId,
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    suggestedNewNamespace: suggestedNewNamespace ?? undefined,
    final: {
      namespaceId,
      agentId,
      domain,
      confidence,
      lowConfidenceThreshold,
      needsHumanReview,
    },
  };

  logger.debug({ trace }, 'Escopo resolvido para item de treinamento');

  return {
    namespaceId,
    agentId,
    domain,
    confidence,
    trace,
    needsHumanReview,
    suggestedNewNamespace: suggestedNewNamespace ?? undefined,
  };
}
