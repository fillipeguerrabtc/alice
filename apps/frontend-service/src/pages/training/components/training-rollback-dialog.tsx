import { Loader2, RefreshCw } from 'lucide-react';
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

type TrainingRollbackDialogProps = {
  isPending: boolean;
  jobName: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onReasonChange: (value: string) => void;
  open: boolean;
  reason: string;
  t: (key: string, options?: Record<string, unknown>) => string;
};

export function TrainingRollbackDialog({
  isPending,
  jobName,
  onConfirm,
  onOpenChange,
  onReasonChange,
  open,
  reason,
  t,
}: TrainingRollbackDialogProps) {
  const isReasonValid = reason.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('training.promotion.rollbackTitle')}</DialogTitle>
          <DialogDescription>
            {t('training.promotion.rollbackDesc', { jobName })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rollback-reason">{t('training.promotion.rollbackReasonLabel')}</Label>
          <Input
            id="rollback-reason"
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder={t('training.promotion.rollbackReasonPlaceholder')}
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground">
            {t('training.promotion.rollbackReasonHint')}
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('training.createJob.cancel')}
          </Button>
          <Button
            variant="outline"
            onClick={onConfirm}
            disabled={isPending || !isReasonValid}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {t('training.actions.rollback')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
