import { getDatabase, schema, eq, and, desc } from '@alice/database';
import { resolveAgentLlmModel } from '@alice/shared-utils';

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';

type TradingAgentRecord = typeof schema.agents.$inferSelect;
type TradingNamespaceRecord = typeof schema.namespaces.$inferSelect;

export function createTradingAgentContextService(deps: {
  TradingConfigErrorCtor: new (message: string) => Error;
}) {
  async function getAgenticSettingsOrDefault(tenantId: string) {
    const db = getDatabase();
    const existing = await db.query.agenticSettings.findFirst({
      where: eq(schema.agenticSettings.tenantId, tenantId),
    });
    if (existing) return existing;

    const [created] = await db
      .insert(schema.agenticSettings)
      .values({
        tenantId,
        webEnabled: true,
        tradingEnabled: true,
        paymentsEnabled: true,
        stackOpsEnabled: true,
        financialApprovalRequired: true,
      })
      .returning();

    if (!created) {
      throw new Error('Falha ao criar agentic_settings para o tenant.');
    }
    return created;
  }

  async function resolveTradingAgentContext(params: {
    tenantId: string;
    agentId?: string;
  }) {
    const db = getDatabase();
    const agent = params.agentId
      ? await db.query.agents.findFirst({
          where: and(
            eq(schema.agents.id, params.agentId),
            eq(schema.agents.tenantId, params.tenantId),
            eq(schema.agents.status, 'active')
          ),
        })
      : null;

    let resolvedAgent = agent;
    let namespace: TradingNamespaceRecord | null = null;

    if (!resolvedAgent) {
      const tradingNamespace = await db.query.namespaces.findFirst({
        where: and(
          eq(schema.namespaces.tenantId, params.tenantId),
          eq(schema.namespaces.slug, 'trading'),
          eq(schema.namespaces.ativo, true)
        ),
      });
      if (!tradingNamespace) {
        throw new Error('Namespace Trading não encontrado para o tenant.');
      }
      namespace = tradingNamespace;
      resolvedAgent = await db.query.agents.findFirst({
        where: and(
          eq(schema.agents.tenantId, params.tenantId),
          eq(schema.agents.namespaceId, tradingNamespace.id),
          eq(schema.agents.status, 'active')
        ),
        orderBy: [desc(schema.agents.atualizadoEm)],
      });
    } else if (resolvedAgent.namespaceId) {
      namespace = (await db.query.namespaces.findFirst({
        where: and(
          eq(schema.namespaces.id, resolvedAgent.namespaceId),
          eq(schema.namespaces.tenantId, params.tenantId)
        ),
      })) ?? null;
    }

    if (!resolvedAgent) {
      throw new deps.TradingConfigErrorCtor('TRADING_SCOPE_REQUIRED: Agente Trading não encontrado ou inativo.');
    }

    if (!namespace || namespace.slug !== 'trading' || !namespace.ativo) {
      throw new deps.TradingConfigErrorCtor('TRADING_SCOPE_REQUIRED: Namespace Trading obrigatório e ativo para operações de Trading.');
    }

    const modelResolution = resolveAgentLlmModel(resolvedAgent.modeloBase || 'Qwen2.5-7B-Instruct-AWQ');
    if (!modelResolution.model) {
      throw new Error(`modeloBase '${resolvedAgent.modeloBase}' não suportado para LLM (Gate 2).`);
    }

    return {
      agent: resolvedAgent as TradingAgentRecord,
      namespace,
      llmConfig: {
        model: modelResolution.model,
        temperature: resolvedAgent.temperaturaModelo ?? undefined,
        maxTokens: resolvedAgent.maxTokens ?? undefined,
      },
    };
  }

  async function resolveSchedulerUserId(tenantId: string): Promise<string> {
    const db = getDatabase();
    const user = await db.query.users.findFirst({
      where: eq(schema.users.tenantId, tenantId),
      orderBy: [desc(schema.users.createdAt)],
    });
    if (!user?.id) {
      throw new Error('Nenhum usuário disponível para executar o scheduler.');
    }
    return user.id;
  }

  function buildTradingSignalSystemPrompt(params: {
    marketType: TradingMarketType;
    marginMode?: TradingMarginMode;
    agent: TradingAgentRecord;
    namespace: TradingNamespaceRecord | null;
    ragContext?: string;
  }): string {
    const context = params.namespace?.contextoSistema?.trim();
    const instructions = params.agent.instrucoes?.trim();
    const personality = params.agent.personalidade?.trim();
    const ragContext = params.ragContext?.trim();

    return [
      'Você é o Agente Trading da Alice. Gere um sinal objetivo e auditável.',
      context ? `Contexto do namespace: ${context}` : null,
      instructions ? `Instruções do agente: ${instructions}` : null,
      personality ? `Personalidade: ${personality}` : null,
      ragContext ? `Conhecimento relevante do histórico de trading:\n${ragContext}` : null,
      `MarketType: ${params.marketType}`,
      params.marginMode ? `MarginMode: ${params.marginMode}` : null,
      'Use o ranking técnico determinístico e o ensemble fornecidos no prompt.',
      'Sinais DEVEM incluir preço de entrada e níveis de saída (TP/SL) quando aplicável.',
      'Para arbitragem, considere timeframes curtos e execução imediata.',
      'Preencha "citedValues" com os valores numéricos EXATOS citados na análise (use apenas números do prompt).',
      'Campos motivators e invalidationReasons DEVEM ter pelo menos 1 item cada.',
      'IMPORTANTE: O campo "confidence" DEVE ser um decimal entre 0.0 e 1.0 (ex: 0.75 para 75%). NÃO use escala 0-100 ou 0-10.',
      'O campo "riskReward" deve ser > 0 (ex: 2.5 para risco/retorno 1:2.5). Se não aplicável, omita o campo.',
      ragContext ? 'Considere os learnings e padrões do histórico acima na sua análise.' : null,
    ].filter(Boolean).join('\n');
  }

  return {
    getAgenticSettingsOrDefault,
    resolveTradingAgentContext,
    resolveSchedulerUserId,
    buildTradingSignalSystemPrompt,
  };
}
