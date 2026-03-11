export const REASONING_MODE_VALUES = ['auto', 'thinking', 'non_thinking'] as const;

export type ReasoningMode = (typeof REASONING_MODE_VALUES)[number];

export const DEFAULT_REASONING_MODE: ReasoningMode = 'auto';

export function isManualReasoningMode(mode: ReasoningMode): mode is Exclude<ReasoningMode, 'auto'> {
  return mode !== 'auto';
}
