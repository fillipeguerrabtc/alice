import type { TFunction } from 'i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type UserDialogMode = 'create' | 'edit';

export type UserDialogProfileState = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  preferredName: string;
  cargo: string;
  departamento: string;
  telefone: string;
  ativo: boolean;
};

type UserDialogProfileSectionProps = {
  assignmentsDisabled: boolean;
  isAdminRole: boolean;
  mode: UserDialogMode;
  onActiveChange: (value: boolean) => void;
  onFieldChange: (field: keyof Omit<UserDialogProfileState, 'ativo'>, value: string) => void;
  state: UserDialogProfileState;
  t: TFunction;
};

export function UserDialogProfileSection({
  assignmentsDisabled,
  isAdminRole,
  mode,
  onActiveChange,
  onFieldChange,
  state,
  t,
}: UserDialogProfileSectionProps) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">{t('usersAdmin.users.sections.profile')}</h4>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="user-email">{t('auth.email')}</Label>
          <Input
            id="user-email"
            type="email"
            value={state.email}
            onChange={(event) => onFieldChange('email', event.target.value)}
            disabled={!isAdminRole}
          />
        </div>
        {mode === 'create' && (
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="user-password">{t('auth.password')}</Label>
            <Input
              id="user-password"
              type="password"
              value={state.password}
              onChange={(event) => onFieldChange('password', event.target.value)}
            />
          </div>
        )}
        {mode === 'edit' && (
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="user-password-edit">{t('usersAdmin.users.newPassword')}</Label>
            <Input
              id="user-password-edit"
              type="password"
              value={state.password}
              onChange={(event) => onFieldChange('password', event.target.value)}
              placeholder={t('usersAdmin.users.newPasswordPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">{t('usersAdmin.users.newPasswordHint')}</p>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="user-first-name">{t('auth.firstName')}</Label>
          <Input
            id="user-first-name"
            value={state.firstName}
            onChange={(event) => onFieldChange('firstName', event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-last-name">{t('auth.lastName')}</Label>
          <Input
            id="user-last-name"
            value={state.lastName}
            onChange={(event) => onFieldChange('lastName', event.target.value)}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="user-preferred-name">{t('usersAdmin.users.preferredName')}</Label>
          <Input
            id="user-preferred-name"
            value={state.preferredName}
            onChange={(event) => onFieldChange('preferredName', event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('usersAdmin.users.preferredNameHint')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-cargo">{t('usersAdmin.users.jobTitle')}</Label>
          <Input
            id="user-cargo"
            value={state.cargo}
            onChange={(event) => onFieldChange('cargo', event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-departamento">{t('usersAdmin.users.department')}</Label>
          <Input
            id="user-departamento"
            value={state.departamento}
            onChange={(event) => onFieldChange('departamento', event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-telefone">{t('usersAdmin.users.phone')}</Label>
          <Input
            id="user-telefone"
            value={state.telefone}
            onChange={(event) => onFieldChange('telefone', event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('usersAdmin.users.status')}</Label>
          <div className="flex items-center gap-3">
            <Switch
              checked={state.ativo}
              onCheckedChange={onActiveChange}
              disabled={assignmentsDisabled}
            />
            <span className="text-xs text-muted-foreground">
              {state.ativo ? t('usersAdmin.users.active') : t('usersAdmin.users.inactive')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
