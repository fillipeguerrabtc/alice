import type { TFunction } from 'i18next';
import { Loader2, Pencil, Trash2, UserPlus } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';

type BaseRoleItem<TRole extends string> = {
  role: TRole;
  descricao: string;
};

type CustomRoleItem = {
  id: string;
  nome: string;
  slug: string;
  baseRole: string;
  ativo?: boolean | null;
};

type RolesTabContentProps<TRole extends string, TCustomRole extends CustomRoleItem> = {
  baseRoles: BaseRoleItem<TRole>[];
  customRolesLoading: boolean;
  filteredRoles: TCustomRole[];
  onCreateRole: () => void;
  onDeleteRole: (roleId: string) => void;
  onEditRole: (role: TCustomRole) => void;
  onManageBasePermissions: (role: TRole) => void;
  onManageRolePermissions: (role: TCustomRole) => void;
  onSearchRolesChange: (value: string) => void;
  roleOptions: Array<{ value: string; label: string }>;
  searchRoles: string;
  t: TFunction;
};

export function RolesTabContent<TRole extends string, TCustomRole extends CustomRoleItem>({
  baseRoles,
  customRolesLoading,
  filteredRoles,
  onCreateRole,
  onDeleteRole,
  onEditRole,
  onManageBasePermissions,
  onManageRolePermissions,
  onSearchRolesChange,
  roleOptions,
  searchRoles,
  t,
}: RolesTabContentProps<TRole, TCustomRole>) {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle>{t('usersAdmin.roles.title')}</CardTitle>
            <CardDescription>{t('usersAdmin.roles.description')}</CardDescription>
          </div>
          <Button onClick={onCreateRole}>
            <UserPlus className="mr-2 h-4 w-4" />
            {t('usersAdmin.roles.new')}
          </Button>
        </div>
        <div className="max-w-sm">
          <Input
            placeholder={t('usersAdmin.roles.searchPlaceholder')}
            value={searchRoles}
            onChange={(event) => onSearchRolesChange(event.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 mb-6">
          <div>
            <h4 className="text-sm font-semibold">{t('usersAdmin.roles.baseTitle')}</h4>
            <p className="text-xs text-muted-foreground">{t('usersAdmin.roles.baseDescription')}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {baseRoles.map((role) => (
              <div key={role.role} className="rounded-md border p-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">{roleOptions.find((item) => item.value === role.role)?.label ?? role.role}</p>
                  <p className="text-xs text-muted-foreground">{role.descricao}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onManageBasePermissions(role.role)}
                >
                  {t('usersAdmin.roles.manageBasePermissions')}
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {customRolesLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common.loading')}
            </div>
          ) : filteredRoles.length === 0 ? (
            <EmptyState title={t('usersAdmin.roles.empty')} className="py-3 text-left" />
          ) : (
            filteredRoles.map((role) => {
              const baseLabel = roleOptions.find((item) => item.value === role.baseRole)?.label || role.baseRole;
              return (
                <div key={role.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="font-medium">{role.nome}</p>
                    <p className="text-xs text-muted-foreground">{role.slug}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">{baseLabel}</Badge>
                      <Badge variant={role.ativo ? 'default' : 'secondary'}>
                        {role.ativo ? t('common.active') : t('common.inactive')}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onManageRolePermissions(role)}
                    >
                      {t('usersAdmin.roles.managePermissions')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEditRole(role)}
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
                          <AlertDialogTitle>{t('usersAdmin.roles.deleteTitle')}</AlertDialogTitle>
                          <AlertDialogDescription>{t('usersAdmin.roles.deleteDescription')}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => onDeleteRole(role.id)}
                          >
                            {t('common.delete')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
