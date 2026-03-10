import { createLogger } from '@alice/logger';
import { eq } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import { PERMISSION_MAP } from '@alice/shared-utils';

const logger = createLogger('auth-permission-catalog');

type PermissionDefinition = {
  codigo: string;
  nome: string;
  descricao: string;
  modulo: string;
};

const MODULE_LABELS: Record<string, string> = {
  auth: 'Autenticação',
  chat: 'Chat',
  rag: 'RAG',
  training: 'Treinamento',
  integrations: 'Integrações',
  images: 'Imagens',
  admin: 'Administração',
  audit: 'Auditoria',
};

const ACTION_LABELS: Record<string, string> = {
  read: 'Visualizar',
  write: 'Editar',
  delete: 'Excluir',
  manage: 'Gerenciar',
  upload: 'Enviar',
  sync: 'Sincronizar',
  approve: 'Aprovar',
  start: 'Iniciar',
  cancel: 'Cancelar',
  retry: 'Reprocessar',
  reconcile: 'Conciliar',
  assign: 'Atribuir',
};

const PERMISSION_OVERRIDES: Record<string, PermissionDefinition> = {
  'admin:alice_core:write': {
    codigo: 'admin:alice_core:write',
    nome: 'Editar Core da Alice',
    descricao: 'Permite editar ética, moral, legal, guardrails, system prompt e identidade do criador.',
    modulo: 'admin',
  },
};

function humanizeToken(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeRoleSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function buildPermissionDefinition(code: string): PermissionDefinition {
  const override = PERMISSION_OVERRIDES[code];
  if (override) return override;

  const [moduleRaw = 'admin', resourceRaw = 'resource', actionRaw = 'read'] = code.split(':');
  const moduleLabel = MODULE_LABELS[moduleRaw] || humanizeToken(moduleRaw);
  const actionLabel = ACTION_LABELS[actionRaw] || humanizeToken(actionRaw);
  const resourceLabel = humanizeToken(resourceRaw);

  return {
    codigo: code,
    nome: `${actionLabel} ${resourceLabel}`,
    descricao: `Permite ${actionLabel.toLowerCase()} ${resourceLabel.toLowerCase()} no módulo ${moduleLabel}.`,
    modulo: moduleRaw,
  };
}

export async function ensurePermissionCatalog(): Promise<void> {
  const db = getDatabase();
  const existing = await db.query.permissions.findMany({
    columns: {
      id: true,
      codigo: true,
      nome: true,
      descricao: true,
      modulo: true,
    },
  });
  const existingCodes = new Set(existing.map((item) => item.codigo));
  const missingCodes = Object.keys(PERMISSION_MAP).filter((code) => !existingCodes.has(code));

  if (missingCodes.length > 0) {
    const newPermissions = missingCodes.map(buildPermissionDefinition);
    await db.insert(schema.permissions).values(newPermissions);
    logger.info({ count: newPermissions.length }, 'Permissões ausentes criadas no catálogo');
  }

  const overrides = Object.values(PERMISSION_OVERRIDES);
  for (const override of overrides) {
    const current = existing.find((perm) => perm.codigo === override.codigo);
    if (!current) continue;
    if (current.nome !== override.nome || current.descricao !== override.descricao || current.modulo !== override.modulo) {
      await db.update(schema.permissions)
        .set({
          nome: override.nome,
          descricao: override.descricao,
          modulo: override.modulo,
        })
        .where(eq(schema.permissions.codigo, override.codigo));
    }
  }

  const allPermissions = await db.query.permissions.findMany({
    columns: { id: true, codigo: true },
  });
  const permissionIds = allPermissions.map((perm) => perm.id);
  const roles = ['admin', 'super_admin'] as const;

  await db.transaction(async (tx) => {
    for (const role of roles) {
      const current = await tx.query.rolePermissions.findMany({
        where: (rolePermissions, { eq }) => eq(rolePermissions.role, role),
        columns: { permissionId: true },
      });
      const currentIds = new Set(current.map((item) => item.permissionId));
      const toAdd = permissionIds.filter((id) => !currentIds.has(id));

      if (toAdd.length > 0) {
        await tx.insert(schema.rolePermissions).values(
          toAdd.map((permissionId) => ({
            role,
            permissionId,
          }))
        );
        logger.info({ role, added: toAdd.length }, 'Permissões atribuídas automaticamente à role');
      }
    }
  });
}
