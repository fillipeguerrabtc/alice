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
