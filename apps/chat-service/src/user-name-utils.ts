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
  const preferredNameFromPrefs = normalizeUserNameValue(
    typeof params.preferences.preferredName === 'string' ? params.preferences.preferredName : ''
  );
  return {
    preferredName: preferredNameFromColumn ?? preferredNameFromPrefs,
    preferredNameFromPrefs,
    shouldBackfillPreferredName: !preferredNameFromColumn && Boolean(preferredNameFromPrefs),
  };
}
