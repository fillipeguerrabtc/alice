export const ROLE_VALUES = ['super_admin', 'admin', 'manager', 'operator', 'viewer', 'guest'] as const;
export type Role = (typeof ROLE_VALUES)[number];

export type CustomRoleItem = {
  id: string;
  nome: string;
  slug: string;
  descricao?: string | null;
  baseRole: Role;
  ativo?: boolean | null;
};

export type UserItem = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  role?: Role | null;
  customRoleId?: string | null;
  customRole?: CustomRoleItem | null;
  roles?: Role[];
  customRoles?: CustomRoleItem[];
  groups?: GroupItem[];
  cargo?: string | null;
  departamento?: string | null;
  telefone?: string | null;
  ativo?: boolean | null;
  ultimoAcesso?: string | null;
  createdAt?: string | null;
  profileImageUrl?: string | null;
  authProvider?: string | null;
};

export type GroupItem = {
  id: string;
  nome: string;
  descricao?: string | null;
  ativo?: boolean | null;
};

export type PermissionItem = {
  id: string;
  codigo: string;
  nome: string;
  descricao?: string | null;
  modulo: string;
};

export type RolePermissionItem = {
  id: string;
  role: Role;
  permissionId: string;
  permission: PermissionItem;
};

export type UsersAdminTabKey = 'users' | 'groups' | 'roles' | 'permissions';
export type UsersAdminWorkspaceKey = 'all' | 'identity' | 'access';

export type UserDialogFormState = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  preferredName: string;
  cargo: string;
  departamento: string;
  telefone: string;
  ativo: boolean;
  roles: Role[];
  customRoleIds: string[];
  groupIds: string[];
};
