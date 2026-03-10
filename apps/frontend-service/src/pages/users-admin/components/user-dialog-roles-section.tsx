import type { TFunction } from 'i18next';
import { Checkbox } from '@/components/ui/checkbox';

type UserDialogRolesSectionProps<TRole extends string> = {
  assignmentsDisabled: boolean;
  onRolesChange: (roles: TRole[]) => void;
  roleOptions: Array<{ value: TRole; label: string }>;
  selectedRoles: TRole[];
  t: TFunction;
};

export function UserDialogRolesSection<TRole extends string>({
  assignmentsDisabled,
  onRolesChange,
  roleOptions,
  selectedRoles,
  t,
}: UserDialogRolesSectionProps<TRole>) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">{t('usersAdmin.users.sections.roles')}</h4>
      <p className="text-xs text-muted-foreground">{t('usersAdmin.users.rolesHint')}</p>
      {assignmentsDisabled && (
        <p className="text-xs text-muted-foreground">{t('usersAdmin.users.superAdminOnly')}</p>
      )}
      <div className="grid gap-2 md:grid-cols-2">
        {roleOptions.map((role) => {
          const checked = selectedRoles.includes(role.value);
          return (
            <label key={role.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={checked}
                disabled={assignmentsDisabled}
                onCheckedChange={(value: boolean | 'indeterminate') => {
                  const isChecked = Boolean(value);
                  const nextRoles = isChecked
                    ? Array.from(new Set([...selectedRoles, role.value]))
                    : selectedRoles.filter((item) => item !== role.value);
                  onRolesChange(nextRoles);
                }}
              />
              {role.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}
