import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { TradingSchedulerForm } from './TradingFormDefaults';

type UseTradingSchedulerFormHandlersOptions = {
  schedulerForm: TradingSchedulerForm;
  setSchedulerForm: Dispatch<SetStateAction<TradingSchedulerForm>>;
};

export function useTradingSchedulerFormHandlers(options: UseTradingSchedulerFormHandlersOptions) {
  const { schedulerForm, setSchedulerForm } = options;

  const handleSchedulerEnabledChange = useCallback((enabled: boolean) => {
    setSchedulerForm({ ...schedulerForm, enabled });
  }, [schedulerForm, setSchedulerForm]);

  const handleSchedulerIntervalMinutesChange = useCallback((value: string) => {
    setSchedulerForm({ ...schedulerForm, intervalMinutes: value });
  }, [schedulerForm, setSchedulerForm]);

  const handleSchedulerMaxSignalsPerRunChange = useCallback((value: string) => {
    setSchedulerForm({ ...schedulerForm, maxSignalsPerRun: value });
  }, [schedulerForm, setSchedulerForm]);

  const handleSchedulerSymbolsChange = useCallback((value: string) => {
    setSchedulerForm({ ...schedulerForm, symbols: value });
  }, [schedulerForm, setSchedulerForm]);

  return {
    handleSchedulerEnabledChange,
    handleSchedulerIntervalMinutesChange,
    handleSchedulerMaxSignalsPerRunChange,
    handleSchedulerSymbolsChange,
  };
}
