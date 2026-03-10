import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import type { GroupItem, UserItem } from '@/pages/users-admin/types';

type GroupMembersDialogProps = {
  group: GroupItem | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  users: UserItem[];
};

function formatUserName(user: Pick<UserItem, 'id' | 'preferredName' | 'firstName' | 'lastName' | 'email'>) {
  if (user.preferredName) return user.preferredName;
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return name || user.email || 'Usuário';
}

export function GroupMembersDialog({
  group,
  onOpenChange,
  open,
  users,
}: GroupMembersDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  const { data: membersData, isLoading } = useQuery<{ members: Array<{ id: string; userId: string }> }>({
    queryKey: ['/api/auth/groups', group?.id, 'users'],
    enabled: open && !!group?.id,
    queryFn: async () => {
      if (!group?.id) {
        return { members: [] };
      }
      const response = await apiRequest('GET', `/api/auth/groups/${group.id}/users`);
      return response.json();
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!group?.id) throw new Error('Grupo inválido');
      const response = await apiRequest('POST', `/api/auth/groups/${group.id}/users`, { userId });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/groups', group?.id, 'users'] });
      setSelectedUserId('');
      toast({ title: t('usersAdmin.groups.membersAdded') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.groups.membersAddError'), description: error.message, variant: 'destructive' });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!group?.id) throw new Error('Grupo inválido');
      const response = await apiRequest('DELETE', `/api/auth/groups/${group.id}/users/${userId}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/groups', group?.id, 'users'] });
      toast({ title: t('usersAdmin.groups.membersRemoved') });
    },
    onError: (error: Error) => {
      toast({ title: t('usersAdmin.groups.membersRemoveError'), description: error.message, variant: 'destructive' });
    },
  });

  const memberIds = new Set(membersData?.members?.map((member) => member.userId) ?? []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-hidden flex flex-col min-h-0">
        <DialogHeader>
          <DialogTitle>{t('usersAdmin.groups.manageMembersTitle')}</DialogTitle>
          <DialogDescription>{group?.nome}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0 pr-1">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('usersAdmin.groups.addMember')}</Label>
              <div className="flex gap-2">
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('usersAdmin.groups.selectUser')} />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id} disabled={memberIds.has(user.id)}>
                        {formatUserName(user)} ({user.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={!selectedUserId || addMemberMutation.isPending}
                  onClick={() => addMemberMutation.mutate(selectedUserId)}
                >
                  {addMemberMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('common.add')}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('usersAdmin.groups.currentMembers')}</Label>
              <div className="space-y-2">
                {isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('common.loading')}
                  </div>
                ) : membersData?.members?.length ? (
                  membersData.members.map((member) => {
                    const user = users.find((item) => item.id === member.userId);
                    return (
                      <div key={member.id} className="flex items-center justify-between rounded-md border p-2">
                        <div>
                          <p className="text-sm font-medium">{formatUserName(user || { id: member.userId })}</p>
                          <p className="text-xs text-muted-foreground">{user?.email}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeMemberMutation.mutate(member.userId)}
                        >
                          {t('common.remove')}
                        </Button>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">{t('usersAdmin.groups.noMembers')}</p>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
