type HeadlineLocale = 'pt-BR' | 'en-US';
type HeadlineTheme = 'playful' | 'provocation' | 'motivation' | 'inspiration' | 'philosophy' | 'momentum';

type UserLocation = {
  city?: string | null;
  countryCode?: string | null;
  countryName?: string | null;
  region?: string | null;
};

type EmptyStateUserContext = {
  email?: string | null;
  firstName?: string | null;
  idioma?: string | null;
  preferredName?: string | null;
  timezone?: string | null;
  preferencias?: {
    location?: UserLocation | null;
  } | null;
} | null;

export type ChatEmptyStateHeadlinePayload = {
  dayPart: 'morning' | 'afternoon' | 'evening' | 'night';
  headline: string;
  locale: HeadlineLocale;
  theme: HeadlineTheme;
  variantKey: string;
};

function resolveDisplayName(user: EmptyStateUserContext): string | null {
  const preferredName = user?.preferredName?.trim();
  if (preferredName) return preferredName.split(/\s+/)[0]?.trim() ?? preferredName;

  const firstName = user?.firstName?.trim();
  if (firstName) return firstName;

  const emailLocal = user?.email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  return emailLocal && emailLocal.length >= 2 ? emailLocal.split(/\s+/)[0]?.trim() ?? emailLocal : null;
}

function resolveLocale(user: EmptyStateUserContext): HeadlineLocale {
  return user?.idioma?.toLowerCase().startsWith('en') ? 'en-US' : 'pt-BR';
}

function resolveLocalHour(user: EmptyStateUserContext, now: Date): number {
  const timeZone = user?.timezone?.trim();
  if (!timeZone) return now.getHours();

  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone,
    }).format(now);
    const parsed = Number.parseInt(formatted, 10);
    return Number.isFinite(parsed) ? parsed : now.getHours();
  } catch {
    return now.getHours();
  }
}

function resolveDayPart(localHour: number): ChatEmptyStateHeadlinePayload['dayPart'] {
  if (localHour >= 5 && localHour < 12) return 'morning';
  if (localHour >= 12 && localHour < 18) return 'afternoon';
  if (localHour >= 18 && localHour < 24) return 'evening';
  return 'night';
}

function resolveLocationLabel(user: EmptyStateUserContext): string | null {
  const location = user?.preferencias?.location;
  if (!location) return null;

  const parts = [location.city, location.region, location.countryName ?? location.countryCode]
    .map((value) => value?.trim())
    .filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 24);

  return parts[0] ?? null;
}

export function buildFallbackChatEmptyStateHeadline(user: EmptyStateUserContext, now = new Date()): ChatEmptyStateHeadlinePayload {
  const locale = resolveLocale(user);
  const dayPart = resolveDayPart(resolveLocalHour(user, now));
  const name = resolveDisplayName(user);
  const locationLabel = resolveLocationLabel(user);

  if (locale === 'en-US') {
    return {
      dayPart,
      headline: name
        ? `${name}, which idea deserves momentum now?`
        : locationLabel
          ? `How is the pace in ${locationLabel} today?`
          : 'What deserves your clearest next step?',
      locale,
      theme: 'momentum',
      variantKey: `fallback:${dayPart}:${name ? 'named' : locationLabel ? 'location' : 'generic'}`,
    };
  }

  return {
    dayPart,
    headline: name
      ? `${name}, qual ideia merece tração agora?`
      : locationLabel
        ? `Como está o ritmo em ${locationLabel} hoje?`
        : 'O que merece seu próximo passo mais claro?',
    locale,
    theme: 'momentum',
    variantKey: `fallback:${dayPart}:${name ? 'named' : locationLabel ? 'location' : 'generic'}`,
  };
}

export function resolveChatEmptyStateHeadline(params: {
  payload?: ChatEmptyStateHeadlinePayload | null;
  user: EmptyStateUserContext;
  hasError: boolean;
  now?: Date;
}): string | null {
  const normalizedHeadline = params.payload?.headline?.trim();
  if (normalizedHeadline) {
    return normalizedHeadline;
  }

  if (!params.hasError) {
    return null;
  }

  return buildFallbackChatEmptyStateHeadline(params.user, params.now).headline;
}
