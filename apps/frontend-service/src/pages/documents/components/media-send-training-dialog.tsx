import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type NamespaceOption = {
  id: string;
  nome: string;
};

type MediaSendTrainingDialogProps = {
  activeNamespaces: NamespaceOption[];
  cancelLabel: string;
  canSubmit: boolean;
  confirmLabel: string;
  confirmLoadingLabel: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onNamespaceChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedNamespaceId: string;
};

export function MediaSendTrainingDialog({
  activeNamespaces,
  cancelLabel,
  canSubmit,
  confirmLabel,
  confirmLoadingLabel,
  isPending,
  onCancel,
  onConfirm,
  onNamespaceChange,
  onOpenChange,
  open,
  selectedNamespaceId,
}: MediaSendTrainingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar para Treinamento</DialogTitle>
          <DialogDescription>
            Selecione o namespace de destino para gerar o dataset dessa mídia.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Select value={selectedNamespaceId} onValueChange={onNamespaceChange}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um namespace" />
            </SelectTrigger>
            <SelectContent>
              {activeNamespaces.map((namespace) => (
                <SelectItem key={namespace.id} value={namespace.id}>
                  {namespace.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button disabled={!canSubmit || isPending} onClick={onConfirm}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {confirmLoadingLabel}
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
