import type { TFunction } from 'i18next';
import { Checkbox } from '@/components/ui/checkbox';

type UserDialogCustomRole = {
  id: string;
  nome: string;
  ativo?: boolean | null;
};

type UserDialogCustomRolesSectionProps<TRole extends UserDialogCustomRole> = {
  assignmentsDisabled: boolean;
  customRoles: TRole[];
  onCustomRoleIdsChange: (roleIds: string[]) => void;
  selectedCustomRoleIds: string[];
  t: TFunction;
};

export function UserDialogCustomRolesSection<TRole extends UserDialogCustomRole>({
  assignmentsDisabled,
  customRoles,
  onCustomRoleIdsChange,
  selectedCustomRoleIds,
  t,
}: UserDialogCustomRolesSectionProps<TRole>) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">{t('usersAdmin.users.sections.customRoles')}</h4>
      <p className="text-xs text-muted-foreground">{t('usersAdmin.users.customRolesHint')}</p>
      <div className="grid gap-2 md:grid-cols-2">
        {customRoles.map((role) => {
          const checked = selectedCustomRoleIds.includes(role.id);
          return (
            <label key={role.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={checked}
                disabled={assignmentsDisabled || role.ativo === false}
                onCheckedChange={(value: boolean | 'indeterminate') => {
                  const isChecked = Boolean(value);
                  const nextIds = isChecked
                    ? Array.from(new Set([...selectedCustomRoleIds, role.id]))
                    : selectedCustomRoleIds.filter((item) => item !== role.id);
                  onCustomRoleIdsChange(nextIds);
                }}
              />
              {role.nome}
            </label>
          );
        })}
        {customRoles.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('usersAdmin.users.customRoleNone')}</p>
        )}
      </div>
    </div>
  );
}
