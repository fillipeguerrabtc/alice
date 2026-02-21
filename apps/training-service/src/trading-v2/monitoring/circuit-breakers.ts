export function shouldTriggerKillSwitch(params: { criticalEvents: number; drawdown: number; maxDrawdown: number }): boolean {
  return params.criticalEvents > 0 || params.drawdown >= params.maxDrawdown;
}
