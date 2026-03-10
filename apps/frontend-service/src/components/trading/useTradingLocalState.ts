import { useRef, useState } from 'react';
import type { TradingControlMode } from './HandoverPanel';
import type { TradingOrder } from './TradingDomainTypes';
import {
  createDefaultOrderForm,
  createDefaultReviewOrderForm,
  createDefaultRiskForm,
  createDefaultSchedulerForm,
  createDefaultSignalForm,
} from './TradingFormDefaults';

export function useTradingLocalState() {
  const [selectedMarketType, setSelectedMarketType] = useState<'futures' | 'spot' | 'margin'>('futures');
  const [selectedMarginMode, setSelectedMarginMode] = useState<'cross' | 'isolated'>('cross');
  const [marketDefaultsInitialized, setMarketDefaultsInitialized] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [symbolReady, setSymbolReady] = useState(false);
  const [selectedInterval, setSelectedInterval] = useState('');
  const [selectedPortfolioAutoId, setSelectedPortfolioAutoId] = useState<string>('');
  const [tradingJobStatus, setTradingJobStatus] = useState<string>('');
  const [activeAutoRunId, setActiveAutoRunId] = useState<string | null>(null);
  const [controlMode, setControlMode] = useState<TradingControlMode>('manual');
  const [autoMix, setAutoMix] = useState(true);
  const [autoUniverseScope, setAutoUniverseScope] = useState<'futures' | 'spot' | 'margin' | 'all'>('futures');
  const [allowedModes, setAllowedModes] = useState<string[]>([]);
  const [autoSelectAllAssets, setAutoSelectAllAssets] = useState(true);
  const [autoSelectedAssetKeys, setAutoSelectedAssetKeys] = useState<string[]>([]);
  const [showNewOrderDialog, setShowNewOrderDialog] = useState(false);
  const [showOcoOrderDialog, setShowOcoOrderDialog] = useState(false);
  const [showRiskConfigDialog, setShowRiskConfigDialog] = useState(false);
  const [showNewSignalDialog, setShowNewSignalDialog] = useState(false);
  const [showPostmortemTrainingDialog, setShowPostmortemTrainingDialog] = useState(false);
  const [showReviewOrderDialog, setShowReviewOrderDialog] = useState(false);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [selectedSignalNewsPresetId, setSelectedSignalNewsPresetId] = useState<string | null>(null);
  const [selectedPostmortemForTraining, setSelectedPostmortemForTraining] = useState<string | null>(null);
  const [selectedTrainingNamespaceId, setSelectedTrainingNamespaceId] = useState<string>('');
  const [signalNewsPresetName, setSignalNewsPresetName] = useState('');
  const [signalNewsPresetDescription, setSignalNewsPresetDescription] = useState('');
  const [reviewOrderTarget, setReviewOrderTarget] = useState<TradingOrder | null>(null);
  const [reviewOrderForm, setReviewOrderForm] = useState(createDefaultReviewOrderForm);
  const [schedulerForm, setSchedulerForm] = useState(createDefaultSchedulerForm);
  const [orderForm, setOrderForm] = useState(createDefaultOrderForm);
  const [riskForm, setRiskForm] = useState(createDefaultRiskForm);
  const [signalForm, setSignalForm] = useState(createDefaultSignalForm);
  const [isManualSignalSavePending, setIsManualSignalSavePending] = useState(false);
  const [positionLiveQuotes, setPositionLiveQuotes] = useState<Record<string, number>>({});

  const autoSaveSignalEnabledRef = useRef(false);
  const autoSaveSignalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveSignalLastPayloadRef = useRef('');
  const autoSaveSignalContextRef = useRef(false);

  return {
    activeAutoRunId,
    allowedModes,
    autoMix,
    autoSaveSignalContextRef,
    autoSaveSignalEnabledRef,
    autoSaveSignalLastPayloadRef,
    autoSaveSignalTimerRef,
    autoSelectAllAssets,
    autoSelectedAssetKeys,
    autoUniverseScope,
    controlMode,
    isManualSignalSavePending,
    marketDefaultsInitialized,
    orderForm,
    positionLiveQuotes,
    reviewOrderForm,
    reviewOrderTarget,
    riskForm,
    schedulerForm,
    selectedInterval,
    selectedMarginMode,
    selectedMarketType,
    selectedPortfolioAutoId,
    selectedPostmortemForTraining,
    selectedSignalId,
    selectedSignalNewsPresetId,
    selectedSymbol,
    selectedTrainingNamespaceId,
    setActiveAutoRunId,
    setAllowedModes,
    setAutoMix,
    setAutoSelectAllAssets,
    setAutoSelectedAssetKeys,
    setAutoUniverseScope,
    setControlMode,
    setIsManualSignalSavePending,
    setMarketDefaultsInitialized,
    setOrderForm,
    setPositionLiveQuotes,
    setReviewOrderForm,
    setReviewOrderTarget,
    setRiskForm,
    setSchedulerForm,
    setSelectedInterval,
    setSelectedMarginMode,
    setSelectedMarketType,
    setSelectedPortfolioAutoId,
    setSelectedPostmortemForTraining,
    setSelectedSignalId,
    setSelectedSignalNewsPresetId,
    setSelectedSymbol,
    setSelectedTrainingNamespaceId,
    setShowNewOrderDialog,
    setShowNewSignalDialog,
    setShowOcoOrderDialog,
    setShowPostmortemTrainingDialog,
    setShowReviewOrderDialog,
    setShowRiskConfigDialog,
    setSignalForm,
    setSignalNewsPresetDescription,
    setSignalNewsPresetName,
    setSymbolReady,
    setTradingJobStatus,
    showNewOrderDialog,
    showNewSignalDialog,
    showOcoOrderDialog,
    showPostmortemTrainingDialog,
    showReviewOrderDialog,
    showRiskConfigDialog,
    signalForm,
    signalNewsPresetDescription,
    signalNewsPresetName,
    symbolReady,
    tradingJobStatus,
  };
}
