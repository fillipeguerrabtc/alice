import { AlertTriangle, FileCheck, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type ChatDialogsSectionProps = {
  deleteAllOpen: boolean;
  deleteSelectedOpen: boolean;
  deleteTargetId: string | null;
  isSubmitTrainingPending: boolean;
  messagesCount: number;
  namespaces: Array<{ id: string; nome: string }> | undefined;
  onConfirmDeleteAll: () => void;
  onConfirmDeleteSelected: () => void;
  onConfirmDeleteTarget: () => void;
  onDeleteAllOpenChange: (open: boolean) => void;
  onDeleteSelectedOpenChange: (open: boolean) => void;
  onDeleteTargetOpenChange: (open: boolean) => void;
  onSubmitTraining: () => void;
  onTrainingDialogOpenChange: (open: boolean) => void;
  onTrainingNamespaceChange: (value: string) => void;
  selectedConversationCount: number;
  selectedMessageCount: number;
  showTrainingDialog: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  trainingDialogMode: 'conversation' | 'messages' | null;
  trainingNamespaceId: string;
};

export function ChatDialogsSection({
  deleteAllOpen,
  deleteSelectedOpen,
  deleteTargetId,
  isSubmitTrainingPending,
  messagesCount,
  namespaces,
  onConfirmDeleteAll,
  onConfirmDeleteSelected,
  onConfirmDeleteTarget,
  onDeleteAllOpenChange,
  onDeleteSelectedOpenChange,
  onDeleteTargetOpenChange,
  onSubmitTraining,
  onTrainingDialogOpenChange,
  onTrainingNamespaceChange,
  selectedConversationCount,
  selectedMessageCount,
  showTrainingDialog,
  t,
  trainingDialogMode,
  trainingNamespaceId,
}: ChatDialogsSectionProps) {
  return (
    <>
      <Dialog open={showTrainingDialog} onOpenChange={onTrainingDialogOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('chat.training.title')}</DialogTitle>
            <DialogDescription>
              {trainingDialogMode === 'messages'
                ? t('chat.training.descMessages', { count: selectedMessageCount })
                : t('chat.training.desc')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>{t('chat.training.namespace')}</Label>
              <Select value={trainingNamespaceId} onValueChange={onTrainingNamespaceChange}>
                <SelectTrigger>
                  <SelectValue placeholder={t('chat.training.selectNamespace')} />
                </SelectTrigger>
                <SelectContent>
                  {(namespaces || []).map((namespace) => (
                    <SelectItem key={namespace.id} value={namespace.id}>
                      {namespace.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {trainingDialogMode === 'conversation' && messagesCount > 10 && (
              <Alert className="border-amber-500/50 bg-amber-500/5">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t('chat.training.longConversationTitle')}</AlertTitle>
                <AlertDescription>{t('chat.training.longConversationDesc')}</AlertDescription>
              </Alert>
            )}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>{t('chat.training.noticeTitle')}</AlertTitle>
              <AlertDescription>{t('chat.training.noticeDesc')}</AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onTrainingDialogOpenChange(false)}>
              {t('chat.training.cancel')}
            </Button>
            <Button onClick={onSubmitTraining} disabled={isSubmitTrainingPending || !trainingNamespaceId}>
              {isSubmitTrainingPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('chat.training.sending')}
                </>
              ) : (
                <>
                  <FileCheck className="h-4 w-4 mr-2" />
                  {trainingDialogMode === 'messages'
                    ? t('chat.selection.sendSelected')
                    : t('chat.training.confirm')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTargetId)} onOpenChange={onDeleteTargetOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversa</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove a conversa e todas as mensagens associadas. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDeleteTarget}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteSelectedOpen} onOpenChange={onDeleteSelectedOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversas selecionadas</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove {selectedConversationCount} conversas e todas as mensagens associadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDeleteSelected}>
              Excluir selecionadas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteAllOpen} onOpenChange={onDeleteAllOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir todas as conversas</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove todas as conversas e mensagens associadas. Esta operação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDeleteAll}>
              Excluir tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
