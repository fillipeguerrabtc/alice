import type { TFunction } from 'i18next';
import { UserPlus, Loader2, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableEmptyRow } from '@/components/ui/table-empty-row';

type UsersTabCustomRole = {
  id: string;
  nome: string;
  ativo?: boolean | null;
};

type UsersTabGroup = {
  id: string;
  nome: string;
};

type UsersTabUser = {
  id: string;
  email?: string | null;
  preferredName?: string | null;
  role?: string | null;
  roles?: string[];
  customRole?: UsersTabCustomRole | null;
  customRoles?: UsersTabCustomRole[];
  groups?: UsersTabGroup[];
  ativo?: boolean | null;
  authProvider?: string | null;
};

type UsersTabContentProps<TUser extends UsersTabUser> = {
  canCreateUser: boolean;
  canEditUser: (user: TUser) => boolean;
  filteredUsers: TUser[];
  formatFullName: (user: TUser) => string;
  onCreateUser: () => void;
  onEditUser: (user: TUser) => void;
  onSearchUsersChange: (value: string) => void;
  onToggleUserStatus: (userId: string, ativo: boolean) => void;
  roleOptions: Array<{ value: string; label: string }>;
  searchUsers: string;
  t: TFunction;
  usersLoading: boolean;
};

export function UsersTabContent<TUser extends UsersTabUser>({
  canCreateUser,
  canEditUser,
  filteredUsers,
  formatFullName,
  onCreateUser,
  onEditUser,
  onSearchUsersChange,
  onToggleUserStatus,
  roleOptions,
  searchUsers,
  t,
  usersLoading,
}: UsersTabContentProps<TUser>) {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle>{t('usersAdmin.users.title')}</CardTitle>
            <CardDescription>{t('usersAdmin.users.description')}</CardDescription>
          </div>
          <Button onClick={onCreateUser} disabled={!canCreateUser}>
            <UserPlus className="mr-2 h-4 w-4" />
            {t('usersAdmin.users.new')}
          </Button>
        </div>
        <div className="max-w-sm">
          <Input
            placeholder={t('usersAdmin.users.searchPlaceholder')}
            value={searchUsers}
            onChange={(event) => onSearchUsersChange(event.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('usersAdmin.users.columns.name')}</TableHead>
              <TableHead>{t('usersAdmin.users.columns.preferredName')}</TableHead>
              <TableHead>{t('usersAdmin.users.columns.email')}</TableHead>
              <TableHead>{t('usersAdmin.users.columns.role')}</TableHead>
              <TableHead>{t('usersAdmin.users.columns.customRole')}</TableHead>
              <TableHead>{t('usersAdmin.users.columns.groups')}</TableHead>
              <TableHead>{t('usersAdmin.users.columns.status')}</TableHead>
              <TableHead>{t('usersAdmin.users.columns.provider')}</TableHead>
              <TableHead>{t('usersAdmin.users.columns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  <Loader2 className="inline-block h-4 w-4 animate-spin mr-2" />
                  {t('common.loading')}
                </TableCell>
              </TableRow>
            ) : filteredUsers.length === 0 ? (
              <TableEmptyRow colSpan={9} message={t('usersAdmin.users.empty')} />
            ) : (
              filteredUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{formatFullName(user)}</TableCell>
                  <TableCell>{user.preferredName || '-'}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(user.roles && user.roles.length > 0 ? user.roles : user.role ? [user.role] : [])
                        .map((role) => (
                          <Badge key={`${user.id}-${role}`} variant="secondary">
                            {roleOptions.find((option) => option.value === role)?.label ?? role}
                          </Badge>
                        ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(user.customRoles ?? (user.customRole ? [user.customRole] : []))
                        .map((role) => (
                          <Badge key={`${user.id}-${role.id}`} variant={role.ativo === false ? 'outline' : 'default'}>
                            {role.nome}
                          </Badge>
                        ))}
                      {(user.customRoles?.length ?? 0) === 0 && !user.customRole && (
                        <span className="text-xs text-muted-foreground">{t('usersAdmin.users.customRoleNone')}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(user.groups ?? []).slice(0, 2).map((group) => (
                        <Badge key={`${user.id}-${group.id}`} variant="outline">
                          {group.nome}
                        </Badge>
                      ))}
                      {(user.groups?.length ?? 0) === 0 && (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                      {(user.groups?.length ?? 0) > 2 && (
                        <Badge variant="outline">+{(user.groups?.length ?? 0) - 2}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={user.ativo ?? false}
                      onCheckedChange={(value) => onToggleUserStatus(user.id, value)}
                      disabled={!canEditUser(user)}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{user.authProvider || t('usersAdmin.users.providerLocal')}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEditUser(user)}
                      aria-label={t('usersAdmin.users.edit')}
                      disabled={!canEditUser(user)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
