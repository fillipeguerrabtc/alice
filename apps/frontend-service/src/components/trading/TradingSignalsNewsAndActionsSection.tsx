import type { TFunction } from 'i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { NewsConfigEditor, type TradingNewsConfigForm, type TradingNewsPresetOption } from './NewsConfigEditor';

type TradingSignalsNewsAndActionsSectionProps = {
  canCreatePreset: boolean;
  canUpdatePreset: boolean;
  isCreatePresetPending: boolean;
  isGeneratePending: boolean;
  isManualSavePending: boolean;
  isUpdatePresetPending: boolean;
  newsConfig: TradingNewsConfigForm;
  newsPresetDescription: string;
  newsPresetName: string;
  onApplyPreset: (preset: TradingNewsPresetOption) => void;
  onChangeNewsConfig: (next: TradingNewsConfigForm) => void;
  onCreatePreset: () => void;
  onDeletePreset: (presetId: string) => void;
  onGenerateNow: () => void;
  onNewsPresetDescriptionChange: (value: string) => void;
  onNewsPresetNameChange: (value: string) => void;
  onSaveProfile: () => void;
  onSelectPresetId: (presetId: string | null) => void;
  onUpdatePreset: () => void;
  presets: TradingNewsPresetOption[];
  selectedPresetId: string | null;
  showArbitrageError: boolean;
  signalProfileInvalid: boolean;
  t: TFunction;
  validationErrorMessage: string;
};

export function TradingSignalsNewsAndActionsSection({
  canCreatePreset,
  canUpdatePreset,
  isCreatePresetPending,
  isGeneratePending,
  isManualSavePending,
  isUpdatePresetPending,
  newsConfig,
  newsPresetDescription,
  newsPresetName,
  onApplyPreset,
  onChangeNewsConfig,
  onCreatePreset,
  onDeletePreset,
  onGenerateNow,
  onNewsPresetDescriptionChange,
  onNewsPresetNameChange,
  onSaveProfile,
  onSelectPresetId,
  onUpdatePreset,
  presets,
  selectedPresetId,
  showArbitrageError,
  signalProfileInvalid,
  t,
  validationErrorMessage,
}: TradingSignalsNewsAndActionsSectionProps) {
  return (
    <>
      <NewsConfigEditor
        value={newsConfig}
        onChange={onChangeNewsConfig}
        title={t('trading.newsConfig.title')}
        description={t('trading.newsConfig.subtitleSignals')}
        presets={presets}
        selectedPresetId={selectedPresetId}
        onSelectPresetId={(presetId) => onSelectPresetId(presetId || null)}
        onApplyPreset={onApplyPreset}
        presetName={newsPresetName}
        presetDescription={newsPresetDescription}
        onPresetNameChange={onNewsPresetNameChange}
        onPresetDescriptionChange={onNewsPresetDescriptionChange}
        onDeletePreset={onDeletePreset}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={onSaveProfile}
          disabled={isManualSavePending || signalProfileInvalid}
        >
          {isManualSavePending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {t('trading.signals.profile.save')}
        </Button>
        <Button
          variant="outline"
          onClick={onGenerateNow}
          disabled={isGeneratePending || showArbitrageError}
        >
          {isGeneratePending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {t('trading.signals.generateNow')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onUpdatePreset}
          disabled={!canUpdatePreset || isUpdatePresetPending}
        >
          {isUpdatePresetPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {t('trading.newsConfig.updatePreset')}
        </Button>
        <Button
          type="button"
          onClick={onCreatePreset}
          disabled={!canCreatePreset || isCreatePresetPending}
        >
          {isCreatePresetPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {t('trading.newsConfig.createPreset')}
        </Button>
      </div>
      {showArbitrageError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {validationErrorMessage}
        </div>
      )}
      <Separator className="my-6" />
    </>
  );
}
