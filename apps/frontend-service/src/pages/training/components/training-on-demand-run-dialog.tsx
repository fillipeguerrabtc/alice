import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Switch } from '@/components/ui/switch';

type NamespaceOption = {
  id: string;
  nome: string;
};

type TrainingOnDemandRunDialogProps = {
  description: string;
  includeImages: boolean;
  isStartPending: boolean;
  namespaces: NamespaceOption[];
  namespaceId: string;
  onDescriptionChange: (value: string) => void;
  onIncludeImagesChange: (value: boolean) => void;
  onNamespaceIdChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onPriorityChange: (value: 'low' | 'normal' | 'high') => void;
  onStart: () => void;
  onTrainingTypeChange: (value: 'incremental' | 'full') => void;
  open: boolean;
  priority: 'low' | 'normal' | 'high';
  t: (key: string, options?: Record<string, unknown>) => string;
  tenantId: string | null | undefined;
  trainingType: 'incremental' | 'full';
};

export function TrainingOnDemandRunDialog({
  description,
  includeImages,
  isStartPending,
  namespaces,
  namespaceId,
  onDescriptionChange,
  onIncludeImagesChange,
  onNamespaceIdChange,
  onOpenChange,
  onPriorityChange,
  onStart,
  onTrainingTypeChange,
  open,
  priority,
  t,
  tenantId,
  trainingType,
}: TrainingOnDemandRunDialogProps) {
  const [preemptionConfirmed, setPreemptionConfirmed] = useState(false);

  useEffect(() => {
    if (!open) {
      setPreemptionConfirmed(false);
    }
  }, [open]);

  const isStartDisabled = !tenantId || isStartPending || !preemptionConfirmed;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('training.autoLearning.onDemandTitle')}</DialogTitle>
          <DialogDescription>{t('training.autoLearning.onDemandDesc')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>{t('training.autoLearning.onDemandType')}</Label>
            <Select value={trainingType} onValueChange={(value) => onTrainingTypeChange(value as 'incremental' | 'full')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="incremental">{t('training.autoLearning.incremental')}</SelectItem>
                <SelectItem value="full">{t('training.autoLearning.complete')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>{t('training.autoLearning.namespace')}</Label>
            <Select value={namespaceId} onValueChange={onNamespaceIdChange}>
              <SelectTrigger>
                <SelectValue placeholder={t('training.autoLearning.namespacePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__tenant__">{t('training.autoLearning.namespaceTenantWide')}</SelectItem>
                {namespaces.map((namespace) => (
                  <SelectItem key={namespace.id} value={namespace.id}>
                    {namespace.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">{t('training.autoLearning.includeImages')}</div>
              <div className="text-xs text-muted-foreground">{t('training.autoLearning.includeImagesDesc')}</div>
            </div>
            <Switch checked={includeImages} onCheckedChange={onIncludeImagesChange} />
          </div>

          <div className="grid gap-2">
            <Label>{t('training.autoLearning.priority')}</Label>
            <Select value={priority} onValueChange={(value) => onPriorityChange(value as 'low' | 'normal' | 'high')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">{t('training.autoLearning.priorityLow')}</SelectItem>
                <SelectItem value="normal">{t('training.autoLearning.priorityNormal')}</SelectItem>
                <SelectItem value="high">{t('training.autoLearning.priorityHigh')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>{t('training.autoLearning.description')}</Label>
            <Input value={description} onChange={(event) => onDescriptionChange(event.target.value)} />
          </div>

          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600" />
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {t('training.autoLearning.preflight.title')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('training.autoLearning.preflight.description')}
                </p>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="training-preemption-preflight"
                    checked={preemptionConfirmed}
                    onCheckedChange={(checked) => setPreemptionConfirmed(Boolean(checked))}
                  />
                  <Label htmlFor="training-preemption-preflight" className="text-xs font-normal">
                    {t('training.autoLearning.preflight.confirm')}
                  </Label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('training.createJob.cancel')}
          </Button>
          <Button onClick={onStart} disabled={isStartDisabled}>
            {isStartPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('training.autoLearning.starting')}
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                {t('training.autoLearning.startOnDemand')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
