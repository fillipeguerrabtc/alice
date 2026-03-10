import { Loader2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type TrainingPostTrainingDialogProps = {
  isReturnPending: boolean;
  jobName: string;
  onBackToChat: () => void;
  onContinueTraining: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
};

export function TrainingPostTrainingDialog({
  isReturnPending,
  jobName,
  onBackToChat,
  onContinueTraining,
  onOpenChange,
  open,
  t,
}: TrainingPostTrainingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('training.postTraining.title')}</DialogTitle>
          <DialogDescription>
            {t('training.postTraining.desc', { jobName })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('training.postTraining.autoReturn')}</p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onContinueTraining}>
            {t('training.postTraining.continueTraining')}
          </Button>
          <Button onClick={onBackToChat} disabled={isReturnPending}>
            {isReturnPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <MessageSquare className="h-4 w-4 mr-2" />
            )}
            {t('training.postTraining.backToChat')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
