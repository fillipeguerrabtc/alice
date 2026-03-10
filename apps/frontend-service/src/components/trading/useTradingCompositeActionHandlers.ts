import { useTradingAccountInvalidation } from './useTradingAccountInvalidation';
import { useTradingDialogFormHandlers } from './useTradingDialogFormHandlers';
import { useTradingPageInteractionHandlers } from './useTradingPageInteractionHandlers';
import { useTradingPostmortemTrainingHandlers } from './useTradingPostmortemTrainingHandlers';
import { useTradingSchedulerFormHandlers } from './useTradingSchedulerFormHandlers';
import { useTradingSignalProfileActionHandlers } from './useTradingSignalProfileActionHandlers';
import { useTradingWorkspaceActionHandlers } from './useTradingWorkspaceActionHandlers';

type UseTradingCompositeActionHandlersOptions = {
  pageInteractionOptions: Parameters<typeof useTradingPageInteractionHandlers>[0];
  postmortemTrainingOptions: Parameters<typeof useTradingPostmortemTrainingHandlers>[0];
  dialogFormOptions: Parameters<typeof useTradingDialogFormHandlers>[0];
  schedulerFormOptions: Parameters<typeof useTradingSchedulerFormHandlers>[0];
  signalProfileActionOptions: Parameters<typeof useTradingSignalProfileActionHandlers>[0];
  workspaceActionOptions: Omit<Parameters<typeof useTradingWorkspaceActionHandlers>[0], 'invalidateAccountQueries'>;
};

export function useTradingCompositeActionHandlers(options: UseTradingCompositeActionHandlersOptions) {
  const pageInteractionHandlers = useTradingPageInteractionHandlers(options.pageInteractionOptions);
  const postmortemTrainingHandlers = useTradingPostmortemTrainingHandlers(options.postmortemTrainingOptions);
  const dialogFormHandlers = useTradingDialogFormHandlers(options.dialogFormOptions);
  const schedulerFormHandlers = useTradingSchedulerFormHandlers(options.schedulerFormOptions);
  const signalProfileHandlers = useTradingSignalProfileActionHandlers(options.signalProfileActionOptions);
  const invalidateAccountQueries = useTradingAccountInvalidation();
  const workspaceHandlers = useTradingWorkspaceActionHandlers({
    ...options.workspaceActionOptions,
    invalidateAccountQueries,
  });

  return {
    ...pageInteractionHandlers,
    ...postmortemTrainingHandlers,
    ...dialogFormHandlers,
    ...schedulerFormHandlers,
    ...signalProfileHandlers,
    ...workspaceHandlers,
  };
}
