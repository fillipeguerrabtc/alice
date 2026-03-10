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
    setSchedulerForm(createSchedulerFormFromConfig(schedulerConfig));
  }, [schedulerConfig, setSchedulerForm]);
}
