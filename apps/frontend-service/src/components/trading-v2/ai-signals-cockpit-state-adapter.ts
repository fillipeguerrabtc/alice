export type SignalsCockpitStateCategory =
  | 'blocked'
  | 'no_trade'
  | 'signal_generated'
  | 'executed'
  | 'failed'
  | 'running';

export type SignalsCockpitAutoRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'success'
  | 'no_trade'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | null;

export type SignalsCockpitApprovalStatus = 'pending' | 'approved' | 'rejected' | null;

export const SIGNALS_COCKPIT_REASON_CODE_TEXT: Record<string, string> = {
  TRADING_SCOPE_REQUIRED: 'Escopo de Trading obrigatório não configurado para executar o run.',
  UNVALIDATED: 'Candidato ainda sem validação estatística mínima (DSR/PBO).',
  LIQUIDITY_CONSTRAINT: 'Sem liquidez mínima: spread alargado ou profundidade insuficiente.',
  GUARDRAIL_BLOCKED: 'Guardrails bloquearam a execução por risco fora da política.',
  NO_CANDIDATES: 'Nenhum candidato elegível foi encontrado no escopo selecionado.',
  NO_EDGE: 'Edge líquido insuficiente para abrir operação com segurança.',
  UNEXPECTED_ERROR: 'Falha inesperada durante o processamento do run.',
  NON_DIRECTIONAL_SIGNAL: 'Somente sinais direcionais podem seguir para execução.',
  VALIDATION_NOT_VALIDATED: 'Validation state precisa estar em validated para elegibilidade de execução.',
  DATASET_CANDIDATE_MISSING: 'Sinal ainda não foi enviado para dataset curation.',
  DATASET_CANDIDATE_NOT_APPROVED: 'Dataset candidate ainda não foi aprovado no Training.',
  DATASET_VERSION_MISSING: 'Ainda não existe dataset version aprovado com esta evidência.',
  CALIBRATION_MISSING: 'Calibração estatística ainda não disponível para o signal.',
  REAL_PROMOTION_REQUIRED: 'Promoção explícita para real eligibility ainda não foi realizada.',
};

export function resolveSignalsCockpitStateCategory(params: {
  hasLinkedSignal: boolean;
  linkedSignalApprovalStatus: SignalsCockpitApprovalStatus;
  latestRunStatus: SignalsCockpitAutoRunStatus;
}): SignalsCockpitStateCategory {
  const { hasLinkedSignal, latestRunStatus, linkedSignalApprovalStatus } = params;
  const normalizedStatus = latestRunStatus === 'success' ? 'succeeded' : latestRunStatus;

  if (!normalizedStatus) {
    if (linkedSignalApprovalStatus === 'approved') return 'executed';
    if (hasLinkedSignal) return 'signal_generated';
    return 'running';
  }

  if (normalizedStatus === 'blocked') return 'blocked';
  if (normalizedStatus === 'no_trade') return 'no_trade';
  if (normalizedStatus === 'failed' || normalizedStatus === 'cancelled') return 'failed';
  if (normalizedStatus === 'succeeded') {
    return linkedSignalApprovalStatus === 'approved' ? 'executed' : 'signal_generated';
  }

  return 'running';
}

export function resolveSignalsCockpitReasonText(
  machineReasonCode: string | null,
  providedReason: string | null,
): string {
  if (providedReason) {
    return providedReason;
  }
  if (!machineReasonCode) {
    return 'Sem reason code explícito para este run.';
  }
  return SIGNALS_COCKPIT_REASON_CODE_TEXT[machineReasonCode] ?? 'Reason code sem descrição cadastrada.';
}

export function resolveSignalsCockpitStateBadge(category: SignalsCockpitStateCategory): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  if (category === 'blocked') {
    return { label: 'blocked', variant: 'secondary' };
  }
  if (category === 'no_trade') {
    return { label: 'no_trade', variant: 'outline' };
  }
  if (category === 'signal_generated') {
    return { label: 'signal_generated', variant: 'default' };
  }
  if (category === 'executed') {
    return { label: 'executed', variant: 'default' };
  }
  if (category === 'failed') {
    return { label: 'failed', variant: 'destructive' };
  }
  return { label: 'running', variant: 'outline' };
}
