import { Loader2 } from 'lucide-react';
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

type TrainingBatchReviewDialogProps = {
  action: 'approve' | 'reject';
  isPending: boolean;
  notes: string;
  onConfirm: () => void;
  onNotesChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedCount: number;
  t: (key: string, options?: Record<string, unknown>) => string;
};

export function TrainingBatchReviewDialog({
  action,
  isPending,
  notes,
  onConfirm,
  onNotesChange,
  onOpenChange,
  open,
  selectedCount,
  t,
}: TrainingBatchReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {action === 'approve'
              ? t('training.batchSelection.approveTitle')
              : t('training.batchSelection.rejectTitle')}
          </DialogTitle>
          <DialogDescription>
            {action === 'approve'
              ? t('training.batchSelection.dialogDescApprove')
              : t('training.batchSelection.dialogDescReject')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="batch-review-notes">{t('training.batchSelection.notes')}</Label>
          <Input
            id="batch-review-notes"
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder={t('training.batchSelection.notesPlaceholder')}
          />
          <p className="text-xs text-muted-foreground">
            {t('training.batchSelection.selected', { count: selectedCount })}
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('training.createJob.cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={selectedCount === 0 || isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('training.batchSelection.saving')}
              </>
            ) : (
              <>{t('training.batchSelection.confirm')}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
