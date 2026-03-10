import { Folder, Loader2 } from 'lucide-react';
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

type NamespaceOption = {
  id: string;
  nome: string;
};

type SuggestedNamespace = {
  name: string;
  theme: string;
};

type TrainingResolveScopeDialogProps = {
  agentId: string;
  createNamespacePending: boolean;
  domain: string;
  entryHasSuggestedNamespace: boolean;
  hasEntry: boolean;
  isResolvePending: boolean;
  namespaceId: string;
  namespaces: NamespaceOption[];
  needsHumanReview: boolean;
  onAgentIdChange: (value: string) => void;
  onConfirm: () => void;
  onCreateSuggestedNamespace: () => void;
  onDomainChange: (value: string) => void;
  onNamespaceIdChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onReasonChange: (value: string) => void;
  open: boolean;
  reason: string;
  suggestedNamespace: SuggestedNamespace | null;
  t: (key: string, options?: Record<string, unknown>) => string;
};

export function TrainingResolveScopeDialog({
  agentId,
  createNamespacePending,
  domain,
  entryHasSuggestedNamespace,
  hasEntry,
  isResolvePending,
  namespaceId,
  namespaces,
  needsHumanReview,
  onAgentIdChange,
  onConfirm,
  onCreateSuggestedNamespace,
  onDomainChange,
  onNamespaceIdChange,
  onOpenChange,
  onReasonChange,
  open,
  reason,
  suggestedNamespace,
  t,
}: TrainingResolveScopeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {needsHumanReview
              ? t('training.resolveScope.title')
              : t('training.resolveScope.relinkTitle')}
          </DialogTitle>
          <DialogDescription>
            {needsHumanReview
              ? t('training.resolveScope.desc')
              : t('training.resolveScope.relinkDesc')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          {needsHumanReview && entryHasSuggestedNamespace && suggestedNamespace && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm font-medium mb-2">{t('training.resolveScope.suggestedTitle')}</p>
              <p className="text-xs text-muted-foreground mb-2">
                {suggestedNamespace.name} ({suggestedNamespace.theme})
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={onCreateSuggestedNamespace}
                disabled={createNamespacePending || isResolvePending}
              >
                {createNamespacePending || isResolvePending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Folder className="h-4 w-4 mr-2" />
                )}
                {t('training.resolveScope.createSuggested')}
              </Button>
            </div>
          )}
          <div className="grid gap-2">
            <Label>{t('training.resolveScope.namespaceSelect')}</Label>
            <Select value={namespaceId || '_none'} onValueChange={(value) => onNamespaceIdChange(value === '_none' ? '' : value)}>
              <SelectTrigger>
                <SelectValue placeholder={t('training.createJob.namespacePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">{t('training.filter.all')}</SelectItem>
                {namespaces.map((namespace) => (
                  <SelectItem key={namespace.id} value={namespace.id}>
                    {namespace.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>{t('training.resolveScope.reason')}</Label>
            <Input
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder={
                needsHumanReview
                  ? t('training.resolveScope.reasonPlaceholder')
                  : t('training.resolveScope.relinkReasonPlaceholder')
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>{t('training.resolveScope.domain')}</Label>
            <Input
              value={domain}
              onChange={(event) => onDomainChange(event.target.value)}
              placeholder="trading, geral..."
            />
          </div>
          <div className="grid gap-2">
            <Label>{t('training.resolveScope.agentId')}</Label>
            <Input
              value={agentId}
              onChange={(event) => onAgentIdChange(event.target.value)}
              placeholder="UUID do agente"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('training.createJob.cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={!hasEntry || isResolvePending}>
            {isResolvePending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('training.reviewDialog.saving')}
              </>
            ) : (
              needsHumanReview
                ? t('training.resolveScope.confirm')
                : t('training.resolveScope.relinkConfirm')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
