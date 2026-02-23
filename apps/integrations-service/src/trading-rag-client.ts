/**
 * Trading RAG Client - Alice Enterprise Platform
 *
 * Cliente para buscar documentos relevantes do RAG Service para enriquecer
 * a geração de sinais IA e post-mortems com contexto de estratégias,
 * learnings anteriores e conhecimento de trading.
 *
 * O RAG Service indexa documentos no namespace do agente trading (Qdrant).
 * Este cliente faz busca semântica por contexto relevante ao par/mercado.
 *
 * Autor: Fillipe Guerra
 * Data: 09 de Fevereiro de 2026
 */

import { createLogger } from '@alice/logger';
import {
  generateInternalAuthHeaders,
} from '@alice/shared-utils';
import type { Role } from '@alice/shared-utils';
import { Counter, Histogram } from 'prom-client';

const logger = createLogger('trading-rag-client');

// ============================================================================
// Métricas Prometheus
// ============================================================================

/** Contador de consultas RAG por tipo e resultado */
const ragQueryCounter = new Counter({
  name: 'alice_trading_rag_query_total',
  help: 'Total de consultas RAG trading por tipo e resultado',
  labelNames: ['type', 'result'] as const,
});

/** Histograma de latência de consultas RAG */
const ragQueryLatency = new Histogram({
  name: 'alice_trading_rag_query_duration_seconds',
  help: 'Latência de consultas RAG trading',
  labelNames: ['type'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 8],
});

/** Contador de indexações de learnings por resultado */
const ragIndexCounter = new Counter({
  name: 'alice_trading_rag_index_total',
  help: 'Total de indexações de learnings no RAG',
  labelNames: ['result'] as const,
});

/** URL do RAG Service para busca de documentos */
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://alice-rag:3003';
/** Timeout para consultas RAG (ms) - conservador para não impactar geração de sinais */
const RAG_QUERY_TIMEOUT_MS = 8000;
/** Número máximo de documentos relevantes a buscar */
const RAG_MAX_RESULTS = 3;
/** Threshold de similaridade mínima (0-1) */
const RAG_SIMILARITY_THRESHOLD = 0.6;

export interface RAGTradingContext {
  /** Contexto textual concatenado dos documentos relevantes */
  context: string;
  /** Fontes dos documentos encontrados */
  sources: Array<{
    documentId: string;
    titulo?: string;
    similarity: number;
  }>;
  /** Número de documentos encontrados */
  documentCount: number;
}

/**
 * Busca contexto RAG relevante para trading.
 *
 * Constrói uma query semântica combinando símbolo, mercado e contexto da análise.
 * Busca documentos no namespace do agente trading que tenham sido indexados
 * (estratégias, learnings de post-mortems anteriores, análises históricas).
 *
 * @param params Parâmetros da busca
 * @returns Contexto RAG ou null se nenhum documento relevante encontrado
 */
export async function queryTradingRAGContext(params: {
  tenantId: string;
  userId: string;
  namespaceId?: string | null;
  symbol: string;
  marketType: string;
  additionalContext?: string;
}): Promise<RAGTradingContext | null> {
  const { tenantId, userId, namespaceId, symbol, marketType, additionalContext } = params;

  // Sem namespace, não há onde buscar documentos
  if (!namespaceId) {
    ragQueryCounter.inc({ type: 'signal', result: 'skipped' });
    logger.debug({ tenantId, symbol }, 'Sem namespace configurado para busca RAG trading');
    return null;
  }

  // Construir query semântica combinando contexto de mercado
  const queryParts = [
    `Estratégia de trading para ${symbol}`,
    `Análise de mercado ${marketType}`,
    `Lições aprendidas e padrões de ${symbol}`,
  ];
  if (additionalContext) {
    queryParts.push(additionalContext);
  }
  const query = queryParts.join('. ');
  const startTime = performance.now();

  try {
    const internalHeaders = generateInternalAuthHeaders({
      userId,
      tenantId,
      role: 'admin' as Role,
    });

    const response = await fetch(`${RAG_SERVICE_URL}/api/rag/context`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...internalHeaders,
      },
      body: JSON.stringify({
        query,
        namespaceId,
        limit: RAG_MAX_RESULTS,
        threshold: RAG_SIMILARITY_THRESHOLD,
      }),
      signal: AbortSignal.timeout(RAG_QUERY_TIMEOUT_MS),
    });

    if (!response.ok) {
      ragQueryCounter.inc({ type: 'signal', result: 'error' });
      ragQueryLatency.observe({ type: 'signal' }, (performance.now() - startTime) / 1000);
      logger.warn(
        { status: response.status, tenantId, symbol },
        'Resposta não-OK do RAG Service para trading context'
      );
      return null;
    }

    const data = await response.json() as {
      context: string;
      sources: Array<{ documentId: string; titulo?: string; similarity: number }>;
    };

    if (!data.context || data.context.trim().length === 0) {
      ragQueryCounter.inc({ type: 'signal', result: 'empty' });
      ragQueryLatency.observe({ type: 'signal' }, (performance.now() - startTime) / 1000);
      logger.debug({ tenantId, symbol, namespaceId }, 'Nenhum documento RAG relevante encontrado');
      return null;
    }

    const result: RAGTradingContext = {
      context: data.context,
      sources: data.sources ?? [],
      documentCount: data.sources?.length ?? 0,
    };

    ragQueryCounter.inc({ type: 'signal', result: 'success' });
    ragQueryLatency.observe({ type: 'signal' }, (performance.now() - startTime) / 1000);

    logger.info({
      tenantId,
      symbol,
      namespaceId,
      documentCount: result.documentCount,
      contextLength: result.context.length,
    }, 'Contexto RAG trading obtido com sucesso');

    return result;
  } catch (error) {
    ragQueryCounter.inc({ type: 'signal', result: 'error' });
    ragQueryLatency.observe({ type: 'signal' }, (performance.now() - startTime) / 1000);
    // Falha no RAG não deve bloquear geração de sinal
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), tenantId, symbol },
      'Falha ao buscar contexto RAG para trading (continuando sem RAG)'
    );
    return null;
  }
}

/**
 * Busca contexto RAG por intent/regime para o Auto Engine.
 * Constrói query especializada combinando intent de operação e regime de mercado.
 * Retorna learnings relevantes por estilo/padrão operacional.
 *
 * @param params Parâmetros da busca
 * @returns Contexto RAG com evidências ou null
 */
export async function queryTradingRAGByIntentRegime(params: {
  tenantId: string;
  userId: string;
  namespaceId?: string | null;
  symbol: string;
  marketType: string;
  operationIntent: string;
  regime: string;
  additionalContext?: string;
}): Promise<RAGTradingContext | null> {
  const { tenantId, userId, namespaceId, symbol, marketType, operationIntent, regime, additionalContext } = params;

  if (!namespaceId) {
    ragQueryCounter.inc({ type: 'intent_regime', result: 'skipped' });
    return null;
  }

  const queryParts = [
    `Estratégia de trading: ${operationIntent}`,
    `Regime de mercado: ${regime}`,
    `Par: ${symbol}`,
    `Mercado: ${marketType}`,
  ];
  if (additionalContext) {
    queryParts.push(additionalContext);
  }
  const query = queryParts.join('. ');

  const endTimer = ragQueryLatency.startTimer({ type: 'intent_regime' });
  try {
    const internalHeaders = generateInternalAuthHeaders({
      userId,
      tenantId,
      role: 'admin' as Role,
    });

    const requestBody = {
      query,
      namespaceId,
      limit: RAG_MAX_RESULTS,
      minSimilarity: RAG_SIMILARITY_THRESHOLD,
    };

    const response = await fetch(`${RAG_SERVICE_URL}/api/rag/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...internalHeaders,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(RAG_QUERY_TIMEOUT_MS),
    });

    endTimer();

    if (!response.ok) {
      ragQueryCounter.inc({ type: 'intent_regime', result: 'error' });
      logger.warn({ status: response.status, symbol, operationIntent, regime }, 'Resposta não-OK do RAG para intent/regime');
      return null;
    }

    const data = await response.json() as {
      success?: boolean;
      data?: Array<{
        id?: string;
        titulo?: string;
        conteudo?: string;
        similarity?: number;
      }>;
    };

    const documents = data.data ?? [];
    if (documents.length === 0) {
      ragQueryCounter.inc({ type: 'intent_regime', result: 'empty' });
      return null;
    }

    const context = documents
      .map((doc) => doc.conteudo ?? '')
      .filter((text) => text.length > 0)
      .join('\n\n---\n\n');

    const sources = documents.map((doc) => ({
      documentId: doc.id ?? '',
      titulo: doc.titulo,
      similarity: doc.similarity ?? 0,
    }));

    ragQueryCounter.inc({ type: 'intent_regime', result: 'success' });
    logger.debug({
      tenantId,
      symbol,
      operationIntent,
      regime,
      documentCount: documents.length,
    }, 'Contexto RAG por intent/regime obtido');

    return {
      context,
      sources,
      documentCount: documents.length,
    };
  } catch (error) {
    endTimer();
    ragQueryCounter.inc({ type: 'intent_regime', result: 'error' });
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), symbol, operationIntent },
      'Falha na busca RAG por intent/regime (não bloqueante)'
    );
    return null;
  }
}

/**
 * Busca contexto RAG específico para post-mortem.
 * Procura learnings anteriores e padrões similares.
 *
 * @param params Parâmetros da busca
 * @returns Contexto RAG ou null
 */
export async function queryPostMortemRAGContext(params: {
  tenantId: string;
  userId: string;
  namespaceId?: string | null;
  symbol: string;
  tradeStyle: string;
  archetype: string;
  pnlPct: number;
}): Promise<RAGTradingContext | null> {
  const { tenantId, userId, namespaceId, symbol, tradeStyle, archetype, pnlPct } = params;

  if (!namespaceId) {
    ragQueryCounter.inc({ type: 'postmortem', result: 'skipped' });
    return null;
  }

  const outcome = pnlPct >= 0 ? 'lucrativa' : 'com prejuízo';
  const query = [
    `Post-mortem de operação ${tradeStyle} em ${symbol}`,
    `Análise de trade ${archetype} ${outcome}`,
    `Lições aprendidas de trades ${tradeStyle} em crypto`,
  ].join('. ');
  const startTime = performance.now();

  try {
    const internalHeaders = generateInternalAuthHeaders({
      userId,
      tenantId,
      role: 'admin' as Role,
    });

    const response = await fetch(`${RAG_SERVICE_URL}/api/rag/context`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...internalHeaders,
      },
      body: JSON.stringify({
        query,
        namespaceId,
        limit: RAG_MAX_RESULTS,
        threshold: RAG_SIMILARITY_THRESHOLD,
      }),
      signal: AbortSignal.timeout(RAG_QUERY_TIMEOUT_MS),
    });

    if (!response.ok) {
      ragQueryCounter.inc({ type: 'postmortem', result: 'error' });
      ragQueryLatency.observe({ type: 'postmortem' }, (performance.now() - startTime) / 1000);
      return null;
    }

    const data = await response.json() as {
      context: string;
      sources: Array<{ documentId: string; titulo?: string; similarity: number }>;
    };

    if (!data.context || data.context.trim().length === 0) {
      ragQueryCounter.inc({ type: 'postmortem', result: 'empty' });
      ragQueryLatency.observe({ type: 'postmortem' }, (performance.now() - startTime) / 1000);
      return null;
    }

    ragQueryCounter.inc({ type: 'postmortem', result: 'success' });
    ragQueryLatency.observe({ type: 'postmortem' }, (performance.now() - startTime) / 1000);

    return {
      context: data.context,
      sources: data.sources ?? [],
      documentCount: data.sources?.length ?? 0,
    };
  } catch (error) {
    ragQueryCounter.inc({ type: 'postmortem', result: 'error' });
    ragQueryLatency.observe({ type: 'postmortem' }, (performance.now() - startTime) / 1000);
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), tenantId, symbol },
      'Falha ao buscar contexto RAG para post-mortem (continuando sem RAG)'
    );
    return null;
  }
}

// ============================================================================
// Feedback Loop: Indexar learnings de post-mortem no RAG
// ============================================================================

/** Timeout para indexação de documentos RAG (ms) */
const RAG_INDEX_TIMEOUT_MS = 10_000;

/**
 * Dados de post-mortem necessários para gerar documento RAG.
 */
export interface PostMortemLearningData {
  postmortemId: string;
  symbol: string;
  marketType: string;
  tradeStyle: string;
  archetype: string;
  strategy: string;
  side: string;
  pnlPct: number;
  realizedPnl: number;
  leverage: number;
  durationSec: number;
  motivators: Array<{
    title: string;
    explanation: string;
    citedValues?: Record<string, string | number>;
  }>;
  successFactors: string[];
  failureFactors: string[];
  lessons: {
    repeat: string[];
    avoid: string[];
  };
  closedAt: string;
}

/**
 * Indexa learnings de um post-mortem completado no namespace trading do RAG.
 *
 * Gera um documento textual estruturado a partir do post-mortem e o envia
 * ao RAG service para indexação no Qdrant. Futuras gerações de sinais IA
 * e post-mortems podem usar esse conhecimento acumulado via busca semântica.
 *
 * Não bloqueante: falhas são logadas mas não propagam erro.
 *
 * @param params Dados do post-mortem + contexto do tenant
 * @returns true se indexado com sucesso, false caso contrário
 */
export async function indexPostMortemLearnings(params: {
  tenantId: string;
  userId: string;
  namespaceId: string;
  learning: PostMortemLearningData;
}): Promise<boolean> {
  const { tenantId, userId, namespaceId, learning } = params;

  try {
    // Construir documento textual estruturado para indexação
    const outcome = learning.pnlPct >= 0 ? 'lucrativa' : 'com prejuízo';
    const pnlFormatted = learning.realizedPnl >= 0
      ? `+${learning.realizedPnl.toFixed(2)}`
      : learning.realizedPnl.toFixed(2);
    const durationFormatted = learning.durationSec < 3600
      ? `${Math.round(learning.durationSec / 60)} minutos`
      : `${(learning.durationSec / 3600).toFixed(1)} horas`;

    const motivatorsText = learning.motivators
      .map(m => `- ${m.title}: ${m.explanation}`)
      .join('\n');

    const successText = learning.successFactors.length > 0
      ? learning.successFactors.map(f => `- ${f}`).join('\n')
      : '- Nenhum fator de sucesso identificado';

    const failureText = learning.failureFactors.length > 0
      ? learning.failureFactors.map(f => `- ${f}`).join('\n')
      : '- Nenhum fator de falha identificado';

    const repeatText = learning.lessons.repeat.length > 0
      ? learning.lessons.repeat.map(l => `- ${l}`).join('\n')
      : '- Sem lições de repetição';

    const avoidText = learning.lessons.avoid.length > 0
      ? learning.lessons.avoid.map(l => `- ${l}`).join('\n')
      : '- Sem lições de evitação';

    const titulo = `Post-Mortem: ${learning.symbol} ${learning.side.toUpperCase()} ${learning.tradeStyle} (${outcome})`;

    const conteudo = [
      `# Post-Mortem Trading: ${learning.symbol}`,
      `Data: ${learning.closedAt}`,
      `Par: ${learning.symbol} | Mercado: ${learning.marketType} | Lado: ${learning.side}`,
      `Estilo: ${learning.tradeStyle} | Arquétipo: ${learning.archetype} | Estratégia: ${learning.strategy}`,
      `Alavancagem: ${learning.leverage}x | Duração: ${durationFormatted}`,
      `Resultado: ${outcome} (PnL: ${pnlFormatted} USDT, ${learning.pnlPct >= 0 ? '+' : ''}${learning.pnlPct.toFixed(2)}%)`,
      '',
      '## Motivadores',
      motivatorsText,
      '',
      '## Fatores de Sucesso',
      successText,
      '',
      '## Fatores de Falha',
      failureText,
      '',
      '## Lições Aprendidas',
      '### Repetir',
      repeatText,
      '### Evitar',
      avoidText,
    ].join('\n');

    const internalHeaders = generateInternalAuthHeaders({
      userId,
      tenantId,
      role: 'admin' as Role,
    });

    const response = await fetch(`${RAG_SERVICE_URL}/api/rag/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...internalHeaders,
      },
      body: JSON.stringify({
        namespaceId,
        titulo,
        conteudo,
        tipo: 'postmortem_learning',
        fonte: `postmortem:${learning.postmortemId}`,
      }),
      signal: AbortSignal.timeout(RAG_INDEX_TIMEOUT_MS),
    });

    if (!response.ok) {
      // 409 = documento já existe (dedup por hash do conteúdo no RAG service)
      if (response.status === 409) {
        logger.debug(
          { postmortemId: learning.postmortemId, symbol: learning.symbol },
          'Post-mortem learning já indexado no RAG (dedup)'
        );
        return true;
      }
      logger.warn(
        { status: response.status, postmortemId: learning.postmortemId },
        'Resposta não-OK do RAG Service ao indexar post-mortem learning'
      );
      return false;
    }

    ragIndexCounter.inc({ result: 'success' });

    logger.info({
      postmortemId: learning.postmortemId,
      symbol: learning.symbol,
      tradeStyle: learning.tradeStyle,
      namespaceId,
      contentLength: conteudo.length,
    }, 'Post-mortem learning indexado no RAG com sucesso (feedback loop)');

    return true;
  } catch (error) {
    ragIndexCounter.inc({ result: 'error' });
    // Falha na indexação não deve bloquear o fluxo de post-mortem
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), postmortemId: learning.postmortemId },
      'Falha ao indexar post-mortem learning no RAG (não bloqueante)'
    );
    return false;
  }
}
