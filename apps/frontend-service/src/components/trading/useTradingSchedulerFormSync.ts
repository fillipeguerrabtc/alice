import { useEffect } from 'react';
import { createSchedulerFormFromConfig, type TradingSchedulerForm } from './TradingFormDefaults';
import type { TradingSignalSchedulerConfig } from './useTradingSignalSchedulerQueries';
import type { Dispatch, SetStateAction } from 'react';

type UseTradingSchedulerFormSyncOptions = {
  schedulerConfig: TradingSignalSchedulerConfig;
  setSchedulerForm: Dispatch<SetStateAction<TradingSchedulerForm>>;
};

export function useTradingSchedulerFormSync({
  schedulerConfig,
  setSchedulerForm,
}: UseTradingSchedulerFormSyncOptions) {
  useEffect(() => {
    if (!schedulerConfig) return;
    const nextForm = createSchedulerFormFromConfig(schedulerConfig);
    setSchedulerForm((previous) => {
      const isEqual = previous.enabled === nextForm.enabled
        && previous.intervalMinutes === nextForm.intervalMinutes
        && previous.maxSignalsPerRun === nextForm.maxSignalsPerRun
        && previous.symbols === nextForm.symbols;
      return isEqual ? previous : nextForm;
    });
  }, [schedulerConfig, setSchedulerForm]);
}
