import type { TFunction } from 'i18next';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableEmptyRow } from '@/components/ui/table-empty-row';

type CustomRoleDialogRole = {
  id: string;
  nome: string;
};

type CustomRoleDialogPermission = {
  id: string;
  codigo: string;
  nome: string;
  modulo: string;
};

type CustomRolePermissionsDialogProps = {
  customRolePermissionsLoading: boolean;
  filteredPermissions: CustomRoleDialogPermission[];
  onClose: () => void;
  onOpenChange: (open: boolean) => void;
  onSearchChange: (value: string) => void;
  onTogglePermission: (permissionCode: string, checked: boolean) => void;
  open: boolean;
  permissionCodes: Set<string>;
  permissionsLoading: boolean;
  searchQuery: string;
  selectedRole?: CustomRoleDialogRole | null;
  t: TFunction;
};

export function CustomRolePermissionsDialog({
  customRolePermissionsLoading,
  filteredPermissions,
  onClose,
  onOpenChange,
  onSearchChange,
  onTogglePermission,
  open,
  permissionCodes,
  permissionsLoading,
  searchQuery,
  selectedRole,
  t,
}: CustomRolePermissionsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('usersAdmin.roles.permissionsTitle')}</DialogTitle>
          <DialogDescription>
            {selectedRole ? t('usersAdmin.roles.permissionsDescription', { name: selectedRole.nome }) : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="max-w-sm">
            <Input
              placeholder={t('usersAdmin.permissions.searchPlaceholder')}
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('usersAdmin.permissions.columns.permission')}</TableHead>
                <TableHead>{t('usersAdmin.permissions.columns.module')}</TableHead>
                <TableHead>{t('usersAdmin.permissions.columns.roleAccess')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {permissionsLoading || customRolePermissionsLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    <Loader2 className="inline-block h-4 w-4 animate-spin mr-2" />
                    {t('common.loading')}
                  </TableCell>
                </TableRow>
              ) : filteredPermissions.length === 0 ? (
                <TableEmptyRow colSpan={3} message={t('usersAdmin.permissions.empty')} />
              ) : (
                filteredPermissions.map((permission) => {
                  const hasRole = permissionCodes.has(permission.codigo);
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
                          checked={hasRole}
                          disabled={!selectedRole}
                          onCheckedChange={(checked) => onTogglePermission(permission.codigo, checked)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
