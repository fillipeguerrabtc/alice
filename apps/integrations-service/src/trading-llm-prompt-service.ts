import type {
  TradingEnsembleResult,
  TradingIndicatorKey,
  TradingProfileDataSources,
  TradingTechnique,
  TradingTechniqueScore,
} from '@alice/shared';
import type { TriangularArbitrageResult } from './trading-arbitrage-service.js';

export type TradingPromptMatrixEntry = {
  interval: string;
  analysis: unknown;
};

export type TradingConsensusSummary = {
  overallSignal: string;
  agreementRatio: number;
  alignedTimeframes: string[];
  misalignedTimeframes: string[];
};

type TradingOrderBookSummary = {
  bestBid: number | null;
  bestAsk: number | null;
  spreadAbs: number | null;
  spreadPct: number | null;
};

type TradingNewsSummary = {
  query: string;
  results: Array<{ title: string; url: string }>;
};

type TradingTrainingSummary = {
  totalApproved: number;
  samples: Array<{ prompt: string; response: string; actionType: string }>;
};

const TRADING_LLM_MAX_CONTEXT_TOKENS = 6144;
const TRADING_LLM_MIN_COMPLETION_TOKENS = 128;
const TRADING_LLM_PROMPT_SAFETY_TOKENS = 128;
const TRADING_LLM_MESSAGE_OVERHEAD_TOKENS = 8;
const TRADING_LLM_TOKEN_HEADROOM_TOKENS = 256;
const TRADING_LLM_CHARS_PER_TOKEN = 2.2;
const TRADING_LLM_MAX_SIGNAL_COMPLETION_TOKENS = 768;
const TRADING_LLM_PROMPT_ESTIMATE_MULTIPLIER = 1.25;
const TRADING_LLM_TOKEN_REGEX_SAFETY_MULTIPLIER = 1.15;
const TRADING_LLM_TOKEN_REGEX_PATTERN = /[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;
const TRADING_LLM_MAX_ANALYSIS_BLOCK_CHARS = 1200;
export const TRADING_LLM_MAX_NEWS_ITEMS = 3;
const TRADING_LLM_MAX_TRAINING_SAMPLES = 3;
const TRADING_LLM_MAX_SOURCE_LINE_CHARS = 180;
const TRADING_LLM_MAX_NEWS_BLOCK_CHARS = 900;

export function createTradingLlmPromptService(deps: {
  truncateText: (input: string, maxLength: number) => string;
  formatAnalysisForLlm: (analysis: unknown) => string;
}) {
  function estimateTokensFromText(value: string): number {
    if (!value) return 0;
    const normalized = value.trim();
    if (!normalized) return 0;
    const lengthEstimate = Math.ceil(normalized.length / TRADING_LLM_CHARS_PER_TOKEN);
    const regexMatches = normalized.match(TRADING_LLM_TOKEN_REGEX_PATTERN);
    const regexEstimate = regexMatches
      ? Math.ceil(regexMatches.length * TRADING_LLM_TOKEN_REGEX_SAFETY_MULTIPLIER)
      : 0;
    return Math.max(lengthEstimate, regexEstimate);
  }

  function buildMultiTimeframePrompt(params: {
    matrix: TradingPromptMatrixEntry[];
    consensus: TradingConsensusSummary;
    indicators: TradingIndicatorKey[];
    dataSources: TradingProfileDataSources;
    orderBook: TradingOrderBookSummary | null;
    news: TradingNewsSummary | null;
    trainingData: TradingTrainingSummary | null;
    techniques: TradingTechnique[];
    techniqueScores: TradingTechniqueScore[];
    ensembleResult: TradingEnsembleResult;
    arbitrageSnapshot: TriangularArbitrageResult | null;
    arbitrageSnapshots?: TriangularArbitrageResult[];
  }): string {
    void params.dataSources;

    const blocks = params.matrix.map((entry) => {
      const analysisBlock = deps.truncateText(
        deps.formatAnalysisForLlm(entry.analysis),
        TRADING_LLM_MAX_ANALYSIS_BLOCK_CHARS
      );
      return `### TIMEFRAME ${entry.interval}\n${analysisBlock}`;
    });

    const sources: string[] = [];
    if (params.orderBook) {
      sources.push(`Order Book:
- Best Bid: ${params.orderBook.bestBid ?? 'N/A'}
- Best Ask: ${params.orderBook.bestAsk ?? 'N/A'}
- Spread: ${params.orderBook.spreadAbs ?? 'N/A'} (${params.orderBook.spreadPct ?? 'N/A'}%)`);
    }
    if (params.news) {
      const newsLines = params.news.results
        .slice(0, TRADING_LLM_MAX_NEWS_ITEMS)
        .map((item) => `- ${deps.truncateText(item.title, TRADING_LLM_MAX_SOURCE_LINE_CHARS)} (${item.url})`)
        .join('\n');
      const newsBlock = `Notícias (SearXNG):
Consulta: ${params.news.query}
${newsLines || '- Nenhum resultado relevante'}`;
      sources.push(deps.truncateText(newsBlock, TRADING_LLM_MAX_NEWS_BLOCK_CHARS));
    }
    if (params.trainingData) {
      const samples = params.trainingData.samples
        .slice(0, TRADING_LLM_MAX_TRAINING_SAMPLES)
        .map((sample) => {
          const prompt = deps.truncateText(sample.prompt, TRADING_LLM_MAX_SOURCE_LINE_CHARS);
          const response = deps.truncateText(sample.response, TRADING_LLM_MAX_SOURCE_LINE_CHARS);
          return `- ${sample.actionType}: ${prompt} → ${response}`;
        })
        .join('\n');
      sources.push(`Dataset aprovado:
Total: ${params.trainingData.totalApproved}
Exemplos:
${samples || '- Nenhum exemplo disponível'}`);
    }

    const techniqueLines = params.techniqueScores
      .sort((a, b) => b.confidence - a.confidence)
      .map((score) => `- ${score.technique}: ${score.signal} (conf ${score.confidence.toFixed(2)})${score.rationale ? ` - ${score.rationale}` : ''}`)
      .join('\n');

    const arbitrageList = params.arbitrageSnapshots?.length
      ? params.arbitrageSnapshots
      : (params.arbitrageSnapshot ? [params.arbitrageSnapshot] : []);
    const arbitrageBlock = arbitrageList.length > 0
      ? `### ARBITRAGEM TRIANGULAR (Top 3)
${arbitrageList.map((snapshot, index) => {
    const feesApplied = snapshot.networkFeesApplied?.length
      ? `\nNetwork fees aplicadas: ${snapshot.networkFeesApplied.map((fee) => `${fee.asset} ${fee.amount} (${fee.fromExchange}→${fee.toExchange})`).join(', ')}`
      : '';
    return `#${index + 1} Intermediário: ${snapshot.intermediateAsset}
Edge estimada: ${snapshot.edgePct.toFixed(2)}%
Rotas:
${snapshot.legs.map((leg) => `- ${leg.from} -> ${leg.to} via ${leg.symbol} (${leg.side}, rate ${leg.rate.toFixed(8)}, exchange ${leg.exchange})`).join('\n')}${feesApplied}`;
  }).join('\n\n')}`
      : '';

    return `
## CONTEXTO MULTI-TIMEFRAME
Indicadores habilitados: ${params.indicators.join(', ')}
Técnicas selecionadas: ${params.techniques.join(', ')}
Ensemble: ${params.ensembleResult.overallSignal.toUpperCase()} (conf ${params.ensembleResult.confidence.toFixed(2)})
Timeframes disponíveis: ${params.matrix.map((entry) => entry.interval).join(', ')}

Ranking técnico (determinístico):
${techniqueLines || '- Nenhuma técnica disponível'}

Consenso (maioria simples):
- Sinal: ${params.consensus.overallSignal.toUpperCase()}
- Acordo: ${(params.consensus.agreementRatio * 100).toFixed(0)}%
- Timeframes alinhados: ${params.consensus.alignedTimeframes.join(', ') || 'Nenhum'}
- Timeframes divergentes: ${params.consensus.misalignedTimeframes.join(', ') || 'Nenhum'}

${blocks.join('\n\n')}

${sources.length > 0 ? `### FONTES EXTRAS\n${sources.join('\n\n')}` : ''}
${arbitrageBlock}
`.trim();
  }

  function resolveMaxTokensForPrompt(params: {
    systemPrompt: string;
    analysisPrompt: string;
    requestedMaxTokens: number;
  }) {
    const systemTokens = estimateTokensFromText(params.systemPrompt);
    const baseTokens = systemTokens + TRADING_LLM_MESSAGE_OVERHEAD_TOKENS;
    let analysisPrompt = params.analysisPrompt;
    let analysisTokens = estimateTokensFromText(analysisPrompt);
    let promptTokens = baseTokens + analysisTokens;
    let bufferedPromptTokens = Math.ceil(promptTokens * TRADING_LLM_PROMPT_ESTIMATE_MULTIPLIER);

    const maxPromptTokens = TRADING_LLM_MAX_CONTEXT_TOKENS
      - TRADING_LLM_PROMPT_SAFETY_TOKENS
      - TRADING_LLM_MIN_COMPLETION_TOKENS;
    const maxPromptTokensBuffered = Math.max(
      0,
      Math.floor(maxPromptTokens / TRADING_LLM_PROMPT_ESTIMATE_MULTIPLIER)
    );

    if (bufferedPromptTokens > maxPromptTokens) {
      const availableAnalysisTokens = Math.max(0, maxPromptTokensBuffered - baseTokens);
      const targetChars = Math.max(0, availableAnalysisTokens * TRADING_LLM_CHARS_PER_TOKEN);
      analysisPrompt = deps.truncateText(analysisPrompt, targetChars);
      analysisTokens = estimateTokensFromText(analysisPrompt);
      promptTokens = baseTokens + analysisTokens;
      bufferedPromptTokens = Math.ceil(promptTokens * TRADING_LLM_PROMPT_ESTIMATE_MULTIPLIER);
    }

    const conservativePromptTokens = Math.ceil(bufferedPromptTokens * 1.1);
    const conservativeMaxCompletionTokens = Math.max(
      TRADING_LLM_MIN_COMPLETION_TOKENS,
      TRADING_LLM_MAX_CONTEXT_TOKENS
        - conservativePromptTokens
        - TRADING_LLM_PROMPT_SAFETY_TOKENS
        - TRADING_LLM_TOKEN_HEADROOM_TOKENS
    );
    const strictMaxCompletionTokens = Math.max(
      TRADING_LLM_MIN_COMPLETION_TOKENS,
      TRADING_LLM_MAX_CONTEXT_TOKENS
        - bufferedPromptTokens
        - TRADING_LLM_PROMPT_SAFETY_TOKENS
    );
    const maxCompletionTokens = Math.min(
      params.requestedMaxTokens,
      conservativeMaxCompletionTokens,
      strictMaxCompletionTokens,
      TRADING_LLM_MAX_SIGNAL_COMPLETION_TOKENS
    );

    return {
      analysisPrompt,
      promptTokens,
      maxCompletionTokens,
    };
  }

  function buildTradingSignalPromptBudget(params: {
    matrix: TradingPromptMatrixEntry[];
    consensus: TradingConsensusSummary;
    indicators: TradingIndicatorKey[];
    dataSources: TradingProfileDataSources;
    orderBook: TradingOrderBookSummary | null;
    news: TradingNewsSummary | null;
    trainingData: TradingTrainingSummary | null;
    techniques: TradingTechnique[];
    techniqueScores: TradingTechniqueScore[];
    ensembleResult: TradingEnsembleResult;
    arbitrageSnapshot: TriangularArbitrageResult | null;
    arbitrageSnapshots?: TriangularArbitrageResult[];
    systemPrompt: string;
    requestedMaxTokens: number;
  }) {
    const buildPromptWithNews = (news: TradingNewsSummary | null) => buildMultiTimeframePrompt({
      matrix: params.matrix,
      consensus: params.consensus,
      indicators: params.indicators,
      dataSources: params.dataSources,
      orderBook: params.orderBook,
      news,
      trainingData: params.trainingData,
      techniques: params.techniques,
      techniqueScores: params.techniqueScores,
      ensembleResult: params.ensembleResult,
      arbitrageSnapshot: params.arbitrageSnapshot,
      arbitrageSnapshots: params.arbitrageSnapshots,
    });

    let rawAnalysisPrompt = buildPromptWithNews(params.news);
    let tokenBudget = resolveMaxTokensForPrompt({
      systemPrompt: params.systemPrompt,
      analysisPrompt: rawAnalysisPrompt,
      requestedMaxTokens: params.requestedMaxTokens,
    });

    const originalNewsCount = params.news?.results?.length ?? 0;
    let usedNewsCount = originalNewsCount;

    if (tokenBudget.analysisPrompt !== rawAnalysisPrompt && originalNewsCount > 0 && params.news) {
      let chosenPrompt = rawAnalysisPrompt;
      let chosenBudget = tokenBudget;

      for (let i = Math.min(originalNewsCount, TRADING_LLM_MAX_NEWS_ITEMS); i >= 0; i -= 1) {
        const trimmedNews = i === 0
          ? { ...params.news, results: [] }
          : { ...params.news, results: params.news.results.slice(0, i) };
        const candidatePrompt = buildPromptWithNews(trimmedNews);
        const candidateBudget = resolveMaxTokensForPrompt({
          systemPrompt: params.systemPrompt,
          analysisPrompt: candidatePrompt,
          requestedMaxTokens: params.requestedMaxTokens,
        });

        chosenPrompt = candidatePrompt;
        chosenBudget = candidateBudget;
        usedNewsCount = i;

        if (candidateBudget.analysisPrompt === candidatePrompt) {
          break;
        }
      }

      rawAnalysisPrompt = chosenPrompt;
      tokenBudget = chosenBudget;
    }

    return {
      rawAnalysisPrompt,
      analysisPrompt: tokenBudget.analysisPrompt,
      promptTokens: tokenBudget.promptTokens,
      maxCompletionTokens: tokenBudget.maxCompletionTokens,
      originalNewsCount,
      usedNewsCount,
    };
  }

  return {
    estimateTokensFromText,
    buildMultiTimeframePrompt,
    resolveMaxTokensForPrompt,
    buildTradingSignalPromptBudget,
  };
}
