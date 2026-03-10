import type { TFunction } from 'i18next';
import { Loader2, Pencil, Trash2, UserPlus } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';

type GroupsTabGroup = {
  id: string;
  nome: string;
  descricao?: string | null;
  ativo?: boolean | null;
};

type GroupsTabContentProps<TGroup extends GroupsTabGroup> = {
  filteredGroups: TGroup[];
  groupsLoading: boolean;
  onCreateGroup: () => void;
  onDeleteGroup: (groupId: string) => void;
  onEditGroup: (group: TGroup) => void;
  onManageMembers: (group: TGroup) => void;
  onSearchGroupsChange: (value: string) => void;
  searchGroups: string;
  t: TFunction;
};

export function GroupsTabContent<TGroup extends GroupsTabGroup>({
  filteredGroups,
  groupsLoading,
  onCreateGroup,
  onDeleteGroup,
  onEditGroup,
  onManageMembers,
  onSearchGroupsChange,
  searchGroups,
  t,
}: GroupsTabContentProps<TGroup>) {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle>{t('usersAdmin.groups.title')}</CardTitle>
            <CardDescription>{t('usersAdmin.groups.description')}</CardDescription>
          </div>
          <Button onClick={onCreateGroup}>
            <UserPlus className="mr-2 h-4 w-4" />
            {t('usersAdmin.groups.new')}
          </Button>
        </div>
        <div className="max-w-sm">
          <Input
            placeholder={t('usersAdmin.groups.searchPlaceholder')}
            value={searchGroups}
            onChange={(event) => onSearchGroupsChange(event.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {groupsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common.loading')}
            </div>
          ) : filteredGroups.length === 0 ? (
            <EmptyState title={t('usersAdmin.groups.empty')} className="py-3 text-left" />
          ) : (
            filteredGroups.map((group) => (
              <div key={group.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="font-medium">{group.nome}</p>
                  <p className="text-xs text-muted-foreground">{group.descricao || t('usersAdmin.groups.noDescription')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={group.ativo ? 'default' : 'secondary'}>
                    {group.ativo ? t('common.active') : t('common.inactive')}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onManageMembers(group)}
                  >
                    {t('usersAdmin.groups.manageMembers')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEditGroup(group)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('usersAdmin.groups.deleteTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('usersAdmin.groups.deleteDescription')}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => onDeleteGroup(group.id)}
                        >
                          {t('common.delete')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
