import type { LucideIcon } from 'lucide-react';
import { Brain, Loader2, Zap } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type TradingManualSignalForm = {
  confidence: string;
  reasoning: string;
  signalType: string;
};

type TradingSignalTypeOption = {
  color: string;
  icon: LucideIcon;
  label: string;
  value: string;
};

type TradingNewSignalDialogProps = {
  isSubmitting: boolean;
  onConfidenceChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onReasoningChange: (value: string) => void;
  onSignalTypeChange: (value: string) => void;
  onSubmit: () => void;
  open: boolean;
  signalForm: TradingManualSignalForm;
  signalTypeOptions: TradingSignalTypeOption[];
  t: TFunction;
};

export function TradingNewSignalDialog({
  isSubmitting,
  onConfidenceChange,
  onOpenChange,
  onReasoningChange,
  onSignalTypeChange,
  onSubmit,
  open,
  signalForm,
  signalTypeOptions,
  t,
}: TradingNewSignalDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            {t('trading.signals.newDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('trading.signals.newDialog.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t('trading.signals.form.type')}</Label>
            <Select
              value={signalForm.signalType}
              onValueChange={onSignalTypeChange}
            >
              <SelectTrigger data-testid="select-signal-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {signalTypeOptions.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    <div className="flex items-center gap-2">
                      <type.icon className={`h-4 w-4 ${type.color}`} />
                      {type.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('trading.signals.form.confidence')}</Label>
            <div className="relative">
              <Input
                type="number"
                value={(parseFloat(signalForm.confidence) * 100).toString()}
                onChange={(event) => onConfidenceChange((parseFloat(event.target.value) / 100).toString())}
                min={50}
                max={100}
                className="pr-8"
                data-testid="input-signal-confidence"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${parseFloat(signalForm.confidence) * 100}%` }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('trading.signals.form.reasoning')}</Label>
            <Input
              placeholder={t('trading.signals.form.reasoningPlaceholder')}
              value={signalForm.reasoning}
              onChange={(event) => onReasoningChange(event.target.value)}
              data-testid="input-signal-reasoning"
            />
            <p className="text-xs text-muted-foreground">
              {t('trading.signals.form.reasoningHint')}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-2" />
            )}
            {t('trading.signals.form.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
