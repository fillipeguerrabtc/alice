export function enforceLlmGuardrails(params: { estimatedTokens: number; promptMode: 'compact' | 'verbose' }) {
  const max = params.promptMode === 'compact' ? 1200 : 2200;
  return {
    allowed: params.estimatedTokens <= max,
    maxTokens: max,
    noTradeIfInsufficient: true,
  };
}
