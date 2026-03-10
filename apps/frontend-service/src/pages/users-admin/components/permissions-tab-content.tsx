import type { TFunction } from 'i18next';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableEmptyRow } from '@/components/ui/table-empty-row';

type PermissionItem = {
  id: string;
  codigo: string;
  nome: string;
  modulo: string;
};

type PermissionsTabContentProps<TRole extends string, TPermission extends PermissionItem> = {
  filteredPermissions: TPermission[];
  isLockedRole: boolean;
  permissionsLoading: boolean;
  roleOptions: Array<{ value: TRole; label: string }>;
  rolePermissionCodes: Set<string>;
  searchPermissions: string;
  selectedRole: TRole;
  t: TFunction;
  onCreatePermission: () => void;
  onDeletePermission: (permissionId: string) => void;
  onEditPermission: (permission: TPermission) => void;
  onRolePermissionToggle: (permissionCode: string, checked: boolean) => void;
  onSearchPermissionsChange: (value: string) => void;
  onSelectedRoleChange: (role: TRole) => void;
};

export function PermissionsTabContent<TRole extends string, TPermission extends PermissionItem>({
  filteredPermissions,
  isLockedRole,
  permissionsLoading,
  roleOptions,
  rolePermissionCodes,
  searchPermissions,
  selectedRole,
  t,
  onCreatePermission,
  onDeletePermission,
  onEditPermission,
  onRolePermissionToggle,
  onSearchPermissionsChange,
  onSelectedRoleChange,
}: PermissionsTabContentProps<TRole, TPermission>) {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle>{t('usersAdmin.permissions.title')}</CardTitle>
            <CardDescription>{t('usersAdmin.permissions.description')}</CardDescription>
          </div>
          <Button onClick={onCreatePermission}>
            {t('usersAdmin.permissions.new')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="w-[220px]">
            <Label>{t('usersAdmin.permissions.roleLabel')}</Label>
            <Select
              value={selectedRole}
              onValueChange={(value) => {
                const nextRole = roleOptions.find((role) => role.value === value)?.value;
                if (nextRole) {
                  onSelectedRoleChange(nextRole);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isLockedRole && (
            <Badge variant="secondary">{t('usersAdmin.permissions.roleAlwaysAllowed')}</Badge>
          )}
          <div className="flex-1 min-w-[240px]">
            <Label>{t('usersAdmin.permissions.searchLabel')}</Label>
            <Input
              placeholder={t('usersAdmin.permissions.searchPlaceholder')}
              value={searchPermissions}
              onChange={(event) => onSearchPermissionsChange(event.target.value)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('usersAdmin.permissions.columns.permission')}</TableHead>
              <TableHead>{t('usersAdmin.permissions.columns.module')}</TableHead>
              <TableHead>{t('usersAdmin.permissions.columns.roleAccess')}</TableHead>
              <TableHead>{t('usersAdmin.permissions.columns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {permissionsLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  <Loader2 className="inline-block h-4 w-4 animate-spin mr-2" />
                  {t('common.loading')}
                </TableCell>
              </TableRow>
            ) : filteredPermissions.length === 0 ? (
              <TableEmptyRow colSpan={4} message={t('usersAdmin.permissions.empty')} />
            ) : (
              filteredPermissions.map((permission) => {
                const hasRole = rolePermissionCodes.has(permission.codigo);
                return (
                  <TableRow key={permission.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{permission.nome}</p>
                        <p className="text-xs text-muted-foreground">{permission.codigo}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{permission.modulo}</Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={isLockedRole ? true : hasRole}
                        disabled={isLockedRole}
                        onCheckedChange={(checked) => onRolePermissionToggle(permission.codigo, checked)}
                      />
                    </TableCell>
                    <TableCell className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onEditPermission(permission)}
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
                            <AlertDialogTitle>{t('usersAdmin.permissions.deleteTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>{t('usersAdmin.permissions.deleteDescription')}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => onDeletePermission(permission.id)}
                            >
                              {t('common.delete')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
