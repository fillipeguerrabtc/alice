import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type TrainingPromoteDialogProps = {
  isPending: boolean;
  jobName: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
};

export function TrainingPromoteDialog({
  isPending,
  jobName,
  onConfirm,
  onOpenChange,
  open,
  t,
}: TrainingPromoteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('training.promotion.promoteTitle')}</DialogTitle>
          <DialogDescription>
            {t('training.promotion.promoteDesc', { jobName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('training.createJob.cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            {t('training.actions.promote')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
