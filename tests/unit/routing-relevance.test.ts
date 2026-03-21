import { describe, expect, it } from 'vitest';
import {
  computeRelevanceScore,
  computeRoutingScore,
  tokenizeForRelevance,
} from '../../apps/chat-service/src/routing-relevance';

describe('routing relevance', () => {
  it('remove stopwords e termos genericos fracos da tokenizacao', () => {
    expect(tokenizeForRelevance('Tudo bem por ai com você no trading hoje?')).toEqual(['trading']);
  });

  it('neutraliza overlap lexical fraco em mensagem curta generalista', () => {
    const agentContext = 'Especialista em psicologia, terapia e acolhimento emocional por texto.';
    expect(computeRoutingScore(agentContext, 'Tudo bem por ai')).toBe(0);
    expect(computeRelevanceScore(agentContext, 'Tudo bem por ai')).toBe(0);
  });

  it('mantem sinal robusto para prompts especialistas reais', () => {
    const agentContext = 'Especialista em psicologia clinica, ansiedade e terapia cognitivo comportamental.';
    expect(computeRoutingScore(agentContext, 'Preciso de ajuda com ansiedade e terapia')).toBeGreaterThan(0.3);
  });

  it('mantem roteamento forte para prompt de dominio curto com token relevante', () => {
    const agentContext = 'Mesa de trading focada em BTC, ETH, alavancagem e futuros.';
    expect(computeRoutingScore(agentContext, 'BTC')).toBeGreaterThan(0.5);
  });
});
