import type { TFunction } from 'i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';

type UserDialogGroup = {
  id: string;
  nome: string;
};

type UserDialogGroupsSectionProps<TGroup extends UserDialogGroup> = {
  assignmentsDisabled: boolean;
  groups: TGroup[];
  onGroupIdsChange: (groupIds: string[]) => void;
  selectedGroupIds: string[];
  t: TFunction;
};

export function UserDialogGroupsSection<TGroup extends UserDialogGroup>({
  assignmentsDisabled,
  groups,
  onGroupIdsChange,
  selectedGroupIds,
  t,
}: UserDialogGroupsSectionProps<TGroup>) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">{t('usersAdmin.users.sections.groups')}</h4>
      <p className="text-xs text-muted-foreground">{t('usersAdmin.users.groupsHint')}</p>
      <div className="grid gap-2 md:grid-cols-2">
        {groups.map((group) => {
          const checked = selectedGroupIds.includes(group.id);
          return (
            <label key={group.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={checked}
                disabled={assignmentsDisabled}
                onCheckedChange={(value: boolean | 'indeterminate') => {
                  const isChecked = Boolean(value);
                  const nextIds = isChecked
                    ? Array.from(new Set([...selectedGroupIds, group.id]))
                    : selectedGroupIds.filter((item) => item !== group.id);
                  onGroupIdsChange(nextIds);
                }}
              />
              {group.nome}
            </label>
          );
        })}
        {groups.length === 0 && (
          <EmptyState title={t('usersAdmin.groups.empty')} className="py-2 text-left [&>p]:text-xs" />
        )}
      </div>
    </div>
  );
}
