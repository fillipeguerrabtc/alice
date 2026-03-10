import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { normalizeTradingNewsConfigForm } from './NewsConfigEditor';
import { buildTradingSignalProfilePayload } from './TradingSignalProfilePayload';
import { DEFAULT_ENSEMBLE_CONFIG, DEFAULT_SIGNAL_TECHNIQUES } from './TradingSignalConfig';
import type { SignalProfilePayload, TradingProfileForm } from './TradingDomainTypes';

type UseTradingSignalProfileAutoSaveOptions = {
  autoSaveDebounceMs: number;
  autoSaveSignalContextRef: MutableRefObject<boolean>;
  autoSaveSignalEnabledRef: MutableRefObject<boolean>;
  autoSaveSignalLastPayloadRef: MutableRefObject<string>;
  autoSaveSignalTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  isSignalProfilePayloadComplete: boolean;
  selectedMarketType: 'futures' | 'spot' | 'margin';
  selectedSymbol: string;
  setSignalProfileForm: Dispatch<SetStateAction<TradingProfileForm>>;
  signalProfilePayload: SignalProfilePayload;
  signalProfileResponse?: { success: boolean; data: TradingProfileForm };
  updateSignalProfile: (payload: SignalProfilePayload) => void;
};

export function useTradingSignalProfileAutoSave({
  autoSaveDebounceMs,
  autoSaveSignalContextRef,
  autoSaveSignalEnabledRef,
  autoSaveSignalLastPayloadRef,
  autoSaveSignalTimerRef,
  isSignalProfilePayloadComplete,
  selectedMarketType,
  selectedSymbol,
  setSignalProfileForm,
  signalProfilePayload,
  signalProfileResponse,
  updateSignalProfile,
}: UseTradingSignalProfileAutoSaveOptions) {
  useEffect(() => {
    if (!signalProfileResponse?.data) return;

    const nextForm: TradingProfileForm = {
      ...signalProfileResponse.data,
      newsConfig: normalizeTradingNewsConfigForm(signalProfileResponse.data.newsConfig),
      techniques: signalProfileResponse.data.techniques?.length
        ? signalProfileResponse.data.techniques
        : DEFAULT_SIGNAL_TECHNIQUES,
      ensembleConfig: signalProfileResponse.data.ensembleConfig ?? DEFAULT_ENSEMBLE_CONFIG,
      arbitrageConfig: signalProfileResponse.data.arbitrageConfig ?? null,
    };
    const nextPayloadKey = JSON.stringify(buildTradingSignalProfilePayload({
      form: nextForm,
      selectedMarketType,
      selectedSymbol,
    }));

    setSignalProfileForm((previous) => {
      const previousPayloadKey = JSON.stringify(buildTradingSignalProfilePayload({
        form: previous,
        selectedMarketType,
        selectedSymbol,
      }));
      return previousPayloadKey === nextPayloadKey ? previous : nextForm;
    });
    autoSaveSignalEnabledRef.current = true;
    autoSaveSignalLastPayloadRef.current = nextPayloadKey;
  }, [
    autoSaveSignalEnabledRef,
    autoSaveSignalLastPayloadRef,
    selectedMarketType,
    selectedSymbol,
    setSignalProfileForm,
    signalProfileResponse,
  ]);

  useEffect(() => {
    if (!autoSaveSignalEnabledRef.current) return;
    if (!isSignalProfilePayloadComplete) return;

    const payloadKey = JSON.stringify(signalProfilePayload);
    if (payloadKey === autoSaveSignalLastPayloadRef.current) return;

    if (autoSaveSignalTimerRef.current) {
      clearTimeout(autoSaveSignalTimerRef.current);
    }

    autoSaveSignalTimerRef.current = setTimeout(() => {
      autoSaveSignalContextRef.current = true;
      updateSignalProfile(signalProfilePayload);
    }, autoSaveDebounceMs);

    return () => {
      if (autoSaveSignalTimerRef.current) {
        clearTimeout(autoSaveSignalTimerRef.current);
      }
    };
  }, [
    autoSaveDebounceMs,
    autoSaveSignalContextRef,
    autoSaveSignalEnabledRef,
    autoSaveSignalLastPayloadRef,
    autoSaveSignalTimerRef,
    isSignalProfilePayloadComplete,
    signalProfilePayload,
    updateSignalProfile,
  ]);
}
