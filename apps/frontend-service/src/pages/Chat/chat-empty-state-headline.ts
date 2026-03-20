type HeadlineLocale = 'pt-BR' | 'en-US';

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
  theme: 'create' | 'work' | 'organize' | 'day_check' | 'start_task' | 'resume';
  variantKey: string;
};

function resolveDisplayName(user: EmptyStateUserContext): string | null {
  const preferredName = user?.preferredName?.trim();
  if (preferredName) return preferredName;

  const firstName = user?.firstName?.trim();
  if (firstName) return firstName;

  const emailLocal = user?.email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  return emailLocal && emailLocal.length >= 2 ? emailLocal : null;
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
    .filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(' - ') : null;
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
        ? `Hi, ${name}, what deserves a clearer next step right now?`
        : locationLabel
          ? `How is the pace in ${locationLabel}, and what deserves priority now?`
          : 'What deserves a clearer next step right now?',
      locale,
      theme: 'organize',
      variantKey: `fallback:${dayPart}:${name ? 'named' : locationLabel ? 'location' : 'generic'}`,
    };
  }

  return {
    dayPart,
    headline: name
      ? `Oi, ${name}, o que merece um próximo passo mais claro agora?`
      : locationLabel
        ? `Como está o ritmo por aí em ${locationLabel} e o que vale priorizar agora?`
        : 'O que merece um próximo passo mais claro agora?',
    locale,
    theme: 'organize',
    variantKey: `fallback:${dayPart}:${name ? 'named' : locationLabel ? 'location' : 'generic'}`,
  };
}
