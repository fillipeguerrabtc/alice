export function detectRegime(volatility: number, trendScore: number): 'risk_on' | 'risk_off' | 'neutral' {
  if (volatility > 0.8) return 'risk_off';
  if (trendScore > 0.6) return 'risk_on';
  return 'neutral';
}
