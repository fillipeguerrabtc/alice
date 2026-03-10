import { FileCheck, Loader2 } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type TradingNamespaceOption = {
  id: string;
  nome: string;
};

type TradingPostmortemTrainingDialogProps = {
  availableNamespaces: TradingNamespaceOption[];
  canSubmit: boolean;
  isSubmitting: boolean;
  onCancel: () => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  onNamespaceChange: (namespaceId: string) => void;
  open: boolean;
  selectedNamespaceId: string;
  t: TFunction;
};

export function TradingPostmortemTrainingDialog({
  availableNamespaces,
  canSubmit,
  isSubmitting,
  onCancel,
  onOpenChange,
  onSubmit,
  onNamespaceChange,
  open,
  selectedNamespaceId,
  t,
}: TradingPostmortemTrainingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Enviar post-mortem para treinamento</DialogTitle>
          <DialogDescription>
            Selecione um namespace de destino para criar o dataset e enviá-lo para aprovação no Training.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label>Namespace</Label>
          <Select value={selectedNamespaceId} onValueChange={onNamespaceChange}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um namespace" />
            </SelectTrigger>
            <SelectContent>
              {availableNamespaces.map((namespace) => (
                <SelectItem key={namespace.id} value={namespace.id}>
                  {namespace.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!canSubmit || isSubmitting} onClick={onSubmit}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <FileCheck className="h-4 w-4 mr-2" />
                Confirmar envio
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
