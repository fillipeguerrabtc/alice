/**
 * Utilitários de treinamento - Chat Service
 *
 * Funções puras para fatiamento de conversas e coleta de training data.
 * Extraídas para permitir testes unitários (Plano TREINAMENTO-LIMITES 11/02/2026).
 *
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

/** Janelas disjuntas para conversas longas (TRL/SFT 2025). Cada janela → 1 training_data. */
export function sliceConversationIntoWindows<T>(
  messages: T[],
  sliceSize: number
): Array<{ slice: T[]; startIndex: number; endIndex: number }> {
  // Guard enterprise: sliceSize negativo/zero causa loop infinito (start += sliceSize decrementa)
  const safeSliceSize = Number.isFinite(sliceSize) && sliceSize > 0 ? sliceSize : 1;
  if (messages.length <= safeSliceSize) {
    return [{ slice: messages, startIndex: 0, endIndex: messages.length - 1 }];
  }
  const windows: Array<{ slice: T[]; startIndex: number; endIndex: number }> = [];
  for (let start = 0; start < messages.length; start += safeSliceSize) {
    const end = Math.min(start + safeSliceSize, messages.length) - 1;
    windows.push({
      slice: messages.slice(start, end + 1),
      startIndex: start,
      endIndex: end,
    });
  }
  return windows;
}
