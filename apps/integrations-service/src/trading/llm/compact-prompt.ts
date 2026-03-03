import type { DecisionPacket } from '../core/decision-packet.js';

export function buildCompactPrompt(packet: DecisionPacket): { prompt: string; chars: number; estimatedTokens: number } {
  const prompt = [
    'Você é uma camada de sanity-check institucional.',
    'NÃO invente dados. Se insuficiente, responda no-trade.',
    'Baseie-se SOMENTE no JSON abaixo:',
    JSON.stringify(packet),
  ].join('\n');
  const chars = prompt.length;
  const estimatedTokens = Math.ceil(chars / 4);
  return { prompt, chars, estimatedTokens };
}
