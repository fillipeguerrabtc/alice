export function applyNoTradeGuardrails(input: {
  expectedEdgeNet: number;
  dsrScore?: number | null;
  pboScore?: number | null;
  riskScore?: number | null;
}): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.expectedEdgeNet <= 0) reasons.push('edge_liquido_negativo');
  if ((input.dsrScore ?? 0) < 0) reasons.push('dsr_invalido');
  if ((input.pboScore ?? 1) > 0.7) reasons.push('pbo_alto');
  if ((input.riskScore ?? 0) > 0.8) reasons.push('risk_score_alto');
  return { allowed: reasons.length === 0, reasons };
}

export function normalizeRiskScore(input: {
  volatility: number;
  drawdown: number;
  concentration: number;
}): number {
  const volatility = Math.min(1, Math.max(0, input.volatility));
  const drawdown = Math.min(1, Math.max(0, input.drawdown));
  const concentration = Math.min(1, Math.max(0, input.concentration));
  const score = (volatility * 0.4) + (drawdown * 0.4) + (concentration * 0.2);
  return Math.min(1, Math.max(0, score));
}
