import { useMemo } from 'react';
import type { TradingProfileForm } from './TradingDomainTypes';
import {
  buildTradingSignalProfilePayload,
  isTradingSignalProfilePayloadComplete,
} from './TradingSignalProfilePayload';

type CandidateWithExpectedEdge = {
  expectedEdge?: number | string | null;
};

type UseTradingDerivedPayloadStateOptions<TCandidate extends CandidateWithExpectedEdge> = {
  selectedMarketType: 'futures' | 'spot' | 'margin';
  selectedSymbol: string;
  signalProfileForm: TradingProfileForm;
  tradingCandidates: TCandidate[];
};

export function useTradingDerivedPayloadState<TCandidate extends CandidateWithExpectedEdge>({
  selectedMarketType,
  selectedSymbol,
  signalProfileForm,
  tradingCandidates,
}: UseTradingDerivedPayloadStateOptions<TCandidate>) {
  const topTradingCandidates = useMemo(
    () => tradingCandidates
      .slice()
      .sort((a, b) => Number(b.expectedEdge ?? 0) - Number(a.expectedEdge ?? 0))
      .slice(0, 8),
    [tradingCandidates],
  );

  const signalProfilePayload = useMemo(
    () => buildTradingSignalProfilePayload({
      form: signalProfileForm,
      selectedMarketType,
      selectedSymbol,
    }),
    [selectedMarketType, selectedSymbol, signalProfileForm],
  );
  const isSignalProfilePayloadComplete = isTradingSignalProfilePayloadComplete(signalProfilePayload);

  return {
    isSignalProfilePayloadComplete,
    signalProfilePayload,
    topTradingCandidates,
  };
}
