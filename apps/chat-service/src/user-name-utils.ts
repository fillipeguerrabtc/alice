export type UserPreferencesRecord = Record<string, unknown>;

export function normalizeUserNameValue(value: string): string | null {
  const cleaned = value
    .replace(/[^\p{L}\p{M}\s'.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length < 2 || cleaned.length > 60) return null;
  return cleaned;
}

export function resolvePreferredNameSources(params: {
  preferredNameColumn: string | null | undefined;
  preferences: UserPreferencesRecord;
}): {
  preferredName: string | null;
  preferredNameFromPrefs: string | null;
  shouldBackfillPreferredName: boolean;
} {
  const preferredNameFromColumn = normalizeUserNameValue(params.preferredNameColumn ?? '');
  const rawPreferredFromPrefs = [
    params.preferences.preferredName,
    params.preferences.preferred_name,
    params.preferences.nomePreferido,
    params.preferences.nome_preferido,
    params.preferences.namePreferred,
  ].find((value) => typeof value === 'string');
  const preferredNameFromPrefs = normalizeUserNameValue(
    typeof rawPreferredFromPrefs === 'string' ? rawPreferredFromPrefs : ''
  );
  return {
    preferredName: preferredNameFromColumn ?? preferredNameFromPrefs,
    preferredNameFromPrefs,
    shouldBackfillPreferredName: !preferredNameFromColumn && Boolean(preferredNameFromPrefs),
  };
}

export function resolveUserDisplayName(params: {
  preferredName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string | null {
  const preferredName = normalizeUserNameValue(params.preferredName ?? '');
  if (preferredName) return preferredName;

  const firstName = normalizeUserNameValue(params.firstName ?? '');
  if (firstName) return firstName;

  const fullName = normalizeUserNameValue(`${params.firstName ?? ''} ${params.lastName ?? ''}`);
  if (fullName) return fullName;

  const emailLocalPart = params.email?.split('@')[0]?.replace(/[._-]+/g, ' ') ?? '';
  return normalizeUserNameValue(emailLocalPart);
}
