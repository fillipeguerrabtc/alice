import type { Request } from 'express';

export type SessionStepUpMethod = 'password' | 'biometric';

export type SessionStepUpState = {
  method: SessionStepUpMethod;
  actionType: 'approval';
  actionRequestId: string | null;
  verifiedAt: string;
};

type SessionWithStepUp = Request['session'] & {
  stepUpAuth?: SessionStepUpState;
};

export function writeApprovalStepUpSession(
  req: Request,
  params: {
    method: SessionStepUpMethod;
    actionRequestId?: string | null;
  },
): void {
  const session = req.session as SessionWithStepUp | undefined;
  if (!session) {
    return;
  }

  session.stepUpAuth = {
    method: params.method,
    actionType: 'approval',
    actionRequestId: params.actionRequestId ?? null,
    verifiedAt: new Date().toISOString(),
  };
}

