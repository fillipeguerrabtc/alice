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

type TrainingReviewDialogProps = {
  hasReviewTarget: boolean;
  isPending: boolean;
  namespaces: NamespaceOption[];
  notes: string;
  onConfirm: () => void;
  onNotesChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onOverrideAgentIdChange: (value: string) => void;
  onOverrideDomainChange: (value: string) => void;
  onOverrideNamespaceIdChange: (value: string) => void;
  onOverrideReasonChange: (value: string) => void;
  onOverrideScopeEnabledChange: (value: boolean) => void;
  open: boolean;
  overrideAgentId: string;
  overrideDomain: string;
  overrideNamespaceId: string;
  overrideReason: string;
  overrideScopeEnabled: boolean;
  reviewStatus: 'approved' | 'rejected' | null;
  t: (key: string, options?: Record<string, unknown>) => string;
};

export function TrainingReviewDialog({
  hasReviewTarget,
  isPending,
  namespaces,
  notes,
  onConfirm,
  onNotesChange,
  onOpenChange,
  onOverrideAgentIdChange,
  onOverrideDomainChange,
  onOverrideNamespaceIdChange,
  onOverrideReasonChange,
  onOverrideScopeEnabledChange,
  open,
  overrideAgentId,
  overrideDomain,
  overrideNamespaceId,
  overrideReason,
  overrideScopeEnabled,
  reviewStatus,
  t,
}: TrainingReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('training.reviewDialog.title')}</DialogTitle>
          <DialogDescription>{t('training.reviewDialog.desc')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="review-notes">{t('training.reviewDialog.notes')}</Label>
          <Input
            id="review-notes"
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder={t('training.reviewDialog.notesPlaceholder')}
          />
        </div>
        {reviewStatus === 'approved' && (
          <div className="grid gap-3 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Override de escopo</p>
                <p className="text-xs text-muted-foreground">
                  Ajuste manual de namespace/agente/domínio antes de aprovar (auditável).
                </p>
              </div>
              <Switch checked={overrideScopeEnabled} onCheckedChange={onOverrideScopeEnabledChange} />
            </div>
            {overrideScopeEnabled && (
              <div className="grid gap-2">
                <Label>Namespace (obrigatório)</Label>
                <Select
                  value={overrideNamespaceId || '_none'}
                  onValueChange={(value) => onOverrideNamespaceIdChange(value === '_none' ? '' : value)}
                >
                  <SelectTrigger data-testid="review-override-namespace-select">
                    <SelectValue placeholder={t('training.createJob.namespacePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">{t('training.createJob.namespacePlaceholder')}</SelectItem>
                    {namespaces.map((namespace) => (
                      <SelectItem key={namespace.id} value={namespace.id}>
                        {namespace.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label htmlFor="override-agent">Agent ID (opcional)</Label>
                <Input
                  id="override-agent"
                  value={overrideAgentId}
                  onChange={(event) => onOverrideAgentIdChange(event.target.value)}
                  placeholder="UUID do agente"
                />
                <Label htmlFor="override-domain">Domínio (opcional)</Label>
                <Input
                  id="override-domain"
                  value={overrideDomain}
                  onChange={(event) => onOverrideDomainChange(event.target.value)}
                  placeholder="trading, fiscal, suporte..."
                />
                <Label htmlFor="override-reason">Motivo do override (obrigatório)</Label>
                <Input
                  id="override-reason"
                  value={overrideReason}
                  onChange={(event) => onOverrideReasonChange(event.target.value)}
                  placeholder="Explique por que o escopo foi ajustado"
                />
              </div>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('training.createJob.cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={!hasReviewTarget || isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('training.reviewDialog.saving')}
              </>
            ) : (
              <>{t('training.reviewDialog.confirm')}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
