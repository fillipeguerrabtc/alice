import { and, eq, schema } from '@alice/database';
import type { Database } from '@alice/database';
import { getNamespaceProfileDefaultConfig } from '@alice/database/system-config';
import {
  NamespaceProfileConfigSchema,
  type NamespaceProfileConfig,
} from '@alice/shared';

type NamespaceProfileRecord = typeof schema.namespaceProfiles.$inferSelect;

type NamespaceProfilePatch = {
  isActive?: boolean;
  autoCollectEnabled?: boolean;
  config?: NamespaceProfileConfig;
};

export type NamespaceProfileRuntime = {
  id: string | null;
  tenantId: string;
  namespaceId: string | null;
  version: number;
  isActive: boolean;
  autoCollectEnabled: boolean;
  config: NamespaceProfileConfig;
};

export async function getDefaultNamespaceProfileConfig(): Promise<NamespaceProfileConfig> {
  return getNamespaceProfileDefaultConfig();
}

export async function getNamespaceProfile(
  db: Database,
  params: { tenantId: string; namespaceId: string }
): Promise<NamespaceProfileRecord | null> {
  const profile = await db.query.namespaceProfiles.findFirst({
    where: and(
      eq(schema.namespaceProfiles.tenantId, params.tenantId),
      eq(schema.namespaceProfiles.namespaceId, params.namespaceId)
    ),
  });
  return profile ?? null;
}

export async function ensureNamespaceProfile(
  db: Database,
  params: { tenantId: string; namespaceId: string }
): Promise<NamespaceProfileRecord> {
  const existing = await getNamespaceProfile(db, params);
  if (existing) return existing;

  const defaultConfig = await getDefaultNamespaceProfileConfig();

  const [created] = await db
    .insert(schema.namespaceProfiles)
    .values({
      tenantId: params.tenantId,
      namespaceId: params.namespaceId,
      version: 1,
      isActive: true,
      autoCollectEnabled: true,
      config: defaultConfig,
      atualizadoEm: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const reconciled = await getNamespaceProfile(db, params);
  if (!reconciled) {
    throw new Error('Falha ao garantir namespace_profile após tentativa idempotente');
  }
  return reconciled;
}

export async function updateNamespaceProfile(
  db: Database,
  params: { tenantId: string; namespaceId: string; patch: NamespaceProfilePatch }
): Promise<NamespaceProfileRecord> {
  const current = await ensureNamespaceProfile(db, {
    tenantId: params.tenantId,
    namespaceId: params.namespaceId,
  });

  const nextConfig = params.patch.config
    ? NamespaceProfileConfigSchema.parse(params.patch.config)
    : current.config;

  const [updated] = await db
    .update(schema.namespaceProfiles)
    .set({
      isActive: params.patch.isActive ?? current.isActive,
      autoCollectEnabled: params.patch.autoCollectEnabled ?? current.autoCollectEnabled,
      config: nextConfig,
      version: current.version + 1,
      atualizadoEm: new Date(),
    })
    .where(and(
      eq(schema.namespaceProfiles.id, current.id),
      eq(schema.namespaceProfiles.tenantId, params.tenantId),
      eq(schema.namespaceProfiles.namespaceId, params.namespaceId)
    ))
    .returning();

  if (!updated) {
    throw new Error('Falha ao atualizar namespace_profile');
  }
  return updated;
}

export async function resolveNamespaceProfileRuntime(
  db: Database,
  params: { tenantId: string; namespaceId?: string | null }
): Promise<NamespaceProfileRuntime> {
  const defaultConfig = await getDefaultNamespaceProfileConfig();
  if (!params.namespaceId) {
    return {
      id: null,
      tenantId: params.tenantId,
      namespaceId: null,
      version: 1,
      isActive: true,
      autoCollectEnabled: false,
      config: defaultConfig,
    };
  }

  const profile = await ensureNamespaceProfile(db, {
    tenantId: params.tenantId,
    namespaceId: params.namespaceId,
  });

  return {
    id: profile.id,
    tenantId: profile.tenantId,
    namespaceId: profile.namespaceId,
    version: profile.version,
    isActive: profile.isActive,
    autoCollectEnabled: profile.autoCollectEnabled,
    config: profile.config,
  };
}
