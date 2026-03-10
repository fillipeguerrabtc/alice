import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { normalizeTradingNewsConfigForm, type TradingNewsConfigForm, type TradingNewsPresetOption } from './NewsConfigEditor';
import type { SignalProfilePayload, TradingProfileForm } from './TradingDomainTypes';

type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

type UseTradingSignalProfileActionHandlersOptions = {
  createNewsPreset: (payload: {
    name: string;
    description?: string | null;
    config: TradingNewsConfigForm;
  }) => void;
  defaultEnsembleConfig: NonNullable<TradingProfileForm['ensembleConfig']>;
  deleteNewsPreset: (presetId: string) => void;
  generateSignal: () => void;
  isManualSignalSavePending: boolean;
  isSignalArbitrageInvalid: boolean;
  normalizedSignalNewsPresetName: string;
  notify: NotifyFn;
  saveSignalProfile: (
    payload: SignalProfilePayload,
    options?: {
      onSettled?: () => void;
    }
  ) => void;
  saveSignalScheduler: () => void;
  selectedSignalNewsPreset: TradingNewsPresetOption | undefined;
  setIsManualSignalSavePending: Dispatch<SetStateAction<boolean>>;
  setSignalProfileForm: Dispatch<SetStateAction<TradingProfileForm>>;
  signalArbitrageErrorMessage: string;
  signalNewsPresetDescription: string;
  signalProfileForm: TradingProfileForm;
  signalProfilePayload: SignalProfilePayload;
  t: TFunction;
  updateNewsPreset: (payload: {
    id: string;
    name: string;
    description?: string | null;
    config: TradingNewsConfigForm;
  }) => void;
};

export function useTradingSignalProfileActionHandlers(options: UseTradingSignalProfileActionHandlersOptions) {
  const {
    createNewsPreset,
    defaultEnsembleConfig,
    deleteNewsPreset,
    generateSignal,
    isManualSignalSavePending,
    isSignalArbitrageInvalid,
    normalizedSignalNewsPresetName,
    notify,
    saveSignalProfile,
    saveSignalScheduler,
    selectedSignalNewsPreset,
    setIsManualSignalSavePending,
    setSignalProfileForm,
    signalArbitrageErrorMessage,
    signalNewsPresetDescription,
    signalProfileForm,
    signalProfilePayload,
    t,
    updateNewsPreset,
  } = options;

  const handleApplyNewsPreset = useCallback((preset: TradingNewsPresetOption) => {
    setSignalProfileForm((previous) => ({
      ...previous,
      newsConfig: normalizeTradingNewsConfigForm(preset.config),
    }));
  }, [setSignalProfileForm]);

  const handleChangeNewsConfig = useCallback((next: TradingNewsConfigForm) => {
    setSignalProfileForm((previous) => ({
      ...previous,
      newsConfig: next,
    }));
  }, [setSignalProfileForm]);

  const handleCreateNewsPreset = useCallback(() => {
    createNewsPreset({
      name: normalizedSignalNewsPresetName,
      description: signalNewsPresetDescription.trim() || null,
      config: signalProfileForm.newsConfig,
    });
  }, [createNewsPreset, normalizedSignalNewsPresetName, signalNewsPresetDescription, signalProfileForm.newsConfig]);

  const handleDeleteNewsPreset = useCallback((presetId: string) => {
    deleteNewsPreset(presetId);
  }, [deleteNewsPreset]);

  const handleEnsembleTopNChange = useCallback((topN: number) => {
    setSignalProfileForm((previous) => ({
      ...previous,
      ensembleConfig: {
        ...defaultEnsembleConfig,
        ...previous.ensembleConfig,
        topN,
      },
    }));
  }, [defaultEnsembleConfig, setSignalProfileForm]);

  const handleGenerateSignalNow = useCallback(() => {
    if (isSignalArbitrageInvalid) {
      notify({
        title: t('trading.errors.signalGenerateFailed'),
        description: signalArbitrageErrorMessage,
        variant: 'destructive',
      });
      return;
    }
    generateSignal();
  }, [generateSignal, isSignalArbitrageInvalid, notify, signalArbitrageErrorMessage, t]);

  const handleSaveSignalProfile = useCallback(() => {
    if (isSignalArbitrageInvalid) {
      notify({
        title: t('trading.errors.profileUpdateFailed'),
        description: signalArbitrageErrorMessage,
        variant: 'destructive',
      });
      return;
    }
    if (isManualSignalSavePending) return;
    setIsManualSignalSavePending(true);
    saveSignalProfile(signalProfilePayload, {
      onSettled: () => {
        setIsManualSignalSavePending(false);
      },
    });
  }, [
    isManualSignalSavePending,
    isSignalArbitrageInvalid,
    notify,
    saveSignalProfile,
    setIsManualSignalSavePending,
    signalArbitrageErrorMessage,
    signalProfilePayload,
    t,
  ]);

  const handleSaveSignalScheduler = useCallback(() => {
    saveSignalScheduler();
  }, [saveSignalScheduler]);

  const handleUpdateNewsPreset = useCallback(() => {
    if (!selectedSignalNewsPreset) return;
    updateNewsPreset({
      id: selectedSignalNewsPreset.id,
      name: normalizedSignalNewsPresetName,
      description: signalNewsPresetDescription.trim() || null,
      config: signalProfileForm.newsConfig,
    });
  }, [
    normalizedSignalNewsPresetName,
    selectedSignalNewsPreset,
    signalNewsPresetDescription,
    signalProfileForm.newsConfig,
    updateNewsPreset,
  ]);

  return {
    handleApplyNewsPreset,
    handleChangeNewsConfig,
    handleCreateNewsPreset,
    handleDeleteNewsPreset,
    handleEnsembleTopNChange,
    handleGenerateSignalNow,
    handleSaveSignalProfile,
    handleSaveSignalScheduler,
    handleUpdateNewsPreset,
  };
}
