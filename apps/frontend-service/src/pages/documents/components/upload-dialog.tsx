import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type UploadDialogProps = {
  namespaceHelperText: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  t: TFunction;
  uploadZone: ReactNode;
};

export function UploadDialog({
  namespaceHelperText,
  onOpenChange,
  open,
  t,
  uploadZone,
}: UploadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('documents.uploadDocument')}</DialogTitle>
          <DialogDescription>{t('documents.uploadZone.supportedTypes')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{namespaceHelperText}</p>
          {uploadZone}
        </div>
      </DialogContent>
    </Dialog>
  );
}
