import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { TradingNewsConfigForm, TradingNewsPresetOption } from './NewsConfigEditor';

type TradingNewsPresetsResponse = {
  success: boolean;
  data: TradingNewsPresetOption[];
};

type TradingNewsPresetMutationResponse = {
  success?: boolean;
  data?: {
    id?: string;
  };
};

type CreateTradingNewsPresetPayload = {
  name: string;
  description?: string | null;
  config: TradingNewsConfigForm;
};

type UpdateTradingNewsPresetPayload = {
  id: string;
  name: string;
  description?: string | null;
  config: TradingNewsConfigForm;
};

type UseTradingNewsPresetsOptions = {
  selectedPresetId: string | null;
  setSelectedPresetId: (presetId: string | null) => void;
  presetName: string;
};

type UseTradingNewsPresetsResult = {
  newsPresets: TradingNewsPresetOption[];
  selectedPreset: TradingNewsPresetOption | undefined;
  normalizedPresetName: string;
  canCreatePreset: boolean;
  canUpdatePreset: boolean;
  isCreatePresetPending: boolean;
  isUpdatePresetPending: boolean;
  createPreset: (payload: CreateTradingNewsPresetPayload) => void;
  updatePreset: (payload: UpdateTradingNewsPresetPayload) => void;
  deletePreset: (presetId: string) => void;
};

const TRADING_NEWS_PRESETS_QUERY_KEY = ['/api/integrations/trading/news-presets'] as const;

export function useTradingNewsPresets(options: UseTradingNewsPresetsOptions): UseTradingNewsPresetsResult {
  const { selectedPresetId, setSelectedPresetId, presetName } = options;
  const { data: newsPresetsResponse } = useQuery<TradingNewsPresetsResponse>({
    queryKey: TRADING_NEWS_PRESETS_QUERY_KEY,
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/integrations/trading/news-presets');
      return response.json();
    },
  });

  const newsPresets = newsPresetsResponse?.data ?? [];
  const selectedPreset = newsPresets.find((preset) => preset.id === selectedPresetId);
  const normalizedPresetName = useMemo(() => presetName.trim(), [presetName]);
  const canCreatePreset = normalizedPresetName.length >= 2;
  const canUpdatePreset = Boolean(selectedPreset && normalizedPresetName.length >= 2);

  const createNewsPresetMutation = useMutation<TradingNewsPresetMutationResponse, Error, CreateTradingNewsPresetPayload>({
    mutationFn: async (payload) => {
      const response = await apiRequest('POST', '/api/integrations/trading/news-presets', payload);
      return response.json();
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: TRADING_NEWS_PRESETS_QUERY_KEY });
      if (response?.data?.id) {
        setSelectedPresetId(response.data.id);
      }
    },
  });

  const updateNewsPresetMutation = useMutation<TradingNewsPresetMutationResponse, Error, UpdateTradingNewsPresetPayload>({
    mutationFn: async (payload) => {
      const { id, ...body } = payload;
      const response = await apiRequest('PUT', `/api/integrations/trading/news-presets/${id}`, body);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRADING_NEWS_PRESETS_QUERY_KEY });
    },
  });

  const deleteNewsPresetMutation = useMutation<TradingNewsPresetMutationResponse, Error, string>({
    mutationFn: async (presetId) => {
      const response = await apiRequest('DELETE', `/api/integrations/trading/news-presets/${presetId}`);
      return response.json();
    },
    onSuccess: (_response, presetId) => {
      queryClient.invalidateQueries({ queryKey: TRADING_NEWS_PRESETS_QUERY_KEY });
      if (selectedPresetId === presetId) {
        setSelectedPresetId(null);
      }
    },
  });

  return {
    newsPresets,
    selectedPreset,
    normalizedPresetName,
    canCreatePreset,
    canUpdatePreset,
    isCreatePresetPending: createNewsPresetMutation.isPending,
    isUpdatePresetPending: updateNewsPresetMutation.isPending,
    createPreset: createNewsPresetMutation.mutate,
    updatePreset: updateNewsPresetMutation.mutate,
    deletePreset: deleteNewsPresetMutation.mutate,
  };
}
