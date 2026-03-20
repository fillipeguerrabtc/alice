import crypto from 'node:crypto';

type SupportedHeadlineLocale = 'pt-BR' | 'en-US';
type HeadlineDayPart = 'morning' | 'afternoon' | 'evening' | 'night';
type HeadlineTheme = 'playful' | 'provocation' | 'motivation' | 'inspiration' | 'philosophy' | 'momentum';
type HeadlineAudience = 'generic' | 'named' | 'location';

type HeadlineTemplate = {
  audience: HeadlineAudience;
  id: string;
  theme: HeadlineTheme;
  render: (params: {
    displayName?: string | null;
    locationLabel?: string | null;
  }) => string;
};

export type ChatEmptyStateHeadlineResult = {
  dayPart: HeadlineDayPart;
  headline: string;
  locale: SupportedHeadlineLocale;
  theme: HeadlineTheme;
  variantKey: string;
};

export type BuildChatEmptyStateHeadlineParams = {
  displayName?: string | null;
  localHour: number;
  locale: SupportedHeadlineLocale;
  locationLabel?: string | null;
  recentVariantKeys?: string[];
  seed: string;
};

const MAX_HEADLINE_LENGTH = 72;

const PT_BR_TEMPLATES: readonly HeadlineTemplate[] = [
  {
    audience: 'named',
    id: 'named-traction',
    theme: 'playful',
    render: ({ displayName }) => `${displayName}, qual ideia merece tração agora?`,
  },
  {
    audience: 'named',
    id: 'named-rhythm',
    theme: 'momentum',
    render: ({ displayName }) => `${displayName}, vamos dar ritmo ao que importa?`,
  },
  {
    audience: 'named',
    id: 'named-stop-waiting',
    theme: 'provocation',
    render: ({ displayName }) => `${displayName}, qual projeto vai parar de esperar hoje?`,
  },
  {
    audience: 'named',
    id: 'named-priority',
    theme: 'motivation',
    render: ({ displayName }) => `${displayName}, vamos fazer o dia obedecer à prioridade certa?`,
  },
  {
    audience: 'named',
    id: 'named-turn',
    theme: 'inspiration',
    render: ({ displayName }) => `${displayName}, e se a virada começar em uma frase?`,
  },
  {
    audience: 'named',
    id: 'named-seneca',
    theme: 'philosophy',
    render: ({ displayName }) => `${displayName}, até Sêneca respeitaria esse próximo passo.`,
  },
  {
    audience: 'named',
    id: 'named-aristotle',
    theme: 'philosophy',
    render: ({ displayName }) => `${displayName}, Aristóteles chamaria de hábito; vamos começar.`,
  },
  {
    audience: 'named',
    id: 'named-clarity',
    theme: 'philosophy',
    render: ({ displayName }) => `${displayName}, clareza primeiro; depois a gente acelera.`,
  },
  {
    audience: 'named',
    id: 'named-courage',
    theme: 'motivation',
    render: ({ displayName }) => `${displayName}, coragem boa é a que já sai trabalhando.`,
  },
  {
    audience: 'named',
    id: 'named-noise',
    theme: 'playful',
    render: ({ displayName }) => `${displayName}, vamos trocar ruído por movimento?`,
  },
  {
    audience: 'generic',
    id: 'generic-traction',
    theme: 'playful',
    render: () => 'Qual ideia merece tração agora?',
  },
  {
    audience: 'generic',
    id: 'generic-noise',
    theme: 'playful',
    render: () => 'Vamos trocar ruído por movimento?',
  },
  {
    audience: 'generic',
    id: 'generic-chaos',
    theme: 'playful',
    render: () => 'Vamos domesticar o caos com elegância?',
  },
  {
    audience: 'generic',
    id: 'generic-stop-waiting',
    theme: 'provocation',
    render: () => 'Qual projeto vai parar de esperar hoje?',
  },
  {
    audience: 'generic',
    id: 'generic-start-now',
    theme: 'provocation',
    render: () => 'E se a melhor resposta de hoje for começar?',
  },
  {
    audience: 'generic',
    id: 'generic-priority',
    theme: 'motivation',
    render: () => 'Vamos fazer o dia obedecer à prioridade certa?',
  },
  {
    audience: 'generic',
    id: 'generic-lighten',
    theme: 'momentum',
    render: () => 'Qual passo deixa o resto mais leve?',
  },
  {
    audience: 'generic',
    id: 'generic-turn',
    theme: 'inspiration',
    render: () => 'Toda boa virada começa pequena e precisa.',
  },
  {
    audience: 'generic',
    id: 'generic-spark',
    theme: 'inspiration',
    render: () => 'Uma frase certa pode mudar o ritmo todo.',
  },
  {
    audience: 'generic',
    id: 'generic-seneca',
    theme: 'philosophy',
    render: () => 'Sêneca aprovaria um começo calmo e preciso.',
  },
  {
    audience: 'generic',
    id: 'generic-descartes',
    theme: 'philosophy',
    render: () => 'Descartes pediria clareza; eu ajudo no resto.',
  },
  {
    audience: 'generic',
    id: 'generic-aristotle',
    theme: 'philosophy',
    render: () => 'Aristóteles chamaria de prática; eu chamo de começar.',
  },
  {
    audience: 'location',
    id: 'location-rhythm',
    theme: 'momentum',
    render: ({ locationLabel }) => `Como está o ritmo em ${locationLabel} hoje?`,
  },
  {
    audience: 'location',
    id: 'location-priority',
    theme: 'inspiration',
    render: ({ locationLabel }) => `O que ${locationLabel} inspira a priorizar agora?`,
  },
] as const;

const EN_US_TEMPLATES: readonly HeadlineTemplate[] = [
  {
    audience: 'named',
    id: 'named-traction',
    theme: 'playful',
    render: ({ displayName }) => `${displayName}, which idea deserves momentum now?`,
  },
  {
    audience: 'named',
    id: 'named-rhythm',
    theme: 'momentum',
    render: ({ displayName }) => `${displayName}, shall we give the right priority some pace?`,
  },
  {
    audience: 'named',
    id: 'named-stop-waiting',
    theme: 'provocation',
    render: ({ displayName }) => `${displayName}, which project stops waiting today?`,
  },
  {
    audience: 'named',
    id: 'named-priority',
    theme: 'motivation',
    render: ({ displayName }) => `${displayName}, shall we let the right priority lead today?`,
  },
  {
    audience: 'named',
    id: 'named-turn',
    theme: 'inspiration',
    render: ({ displayName }) => `${displayName}, what if the turn starts with one sharp sentence?`,
  },
  {
    audience: 'named',
    id: 'named-seneca',
    theme: 'philosophy',
    render: ({ displayName }) => `${displayName}, even Seneca would respect that next step.`,
  },
  {
    audience: 'named',
    id: 'named-aristotle',
    theme: 'philosophy',
    render: ({ displayName }) => `${displayName}, Aristotle would call it practice; I call it starting.`,
  },
  {
    audience: 'named',
    id: 'named-clarity',
    theme: 'philosophy',
    render: ({ displayName }) => `${displayName}, clarity first; then we add speed.`,
  },
  {
    audience: 'named',
    id: 'named-courage',
    theme: 'motivation',
    render: ({ displayName }) => `${displayName}, the best courage is already doing the work.`,
  },
  {
    audience: 'named',
    id: 'named-noise',
    theme: 'playful',
    render: ({ displayName }) => `${displayName}, shall we trade noise for motion?`,
  },
  {
    audience: 'generic',
    id: 'generic-traction',
    theme: 'playful',
    render: () => 'Which idea deserves momentum now?',
  },
  {
    audience: 'generic',
    id: 'generic-noise',
    theme: 'playful',
    render: () => 'Shall we trade noise for motion?',
  },
  {
    audience: 'generic',
    id: 'generic-chaos',
    theme: 'playful',
    render: () => 'Shall we tame the chaos with some elegance?',
  },
  {
    audience: 'generic',
    id: 'generic-stop-waiting',
    theme: 'provocation',
    render: () => 'Which project stops waiting today?',
  },
  {
    audience: 'generic',
    id: 'generic-start-now',
    theme: 'provocation',
    render: () => 'What if the best answer today is to begin?',
  },
  {
    audience: 'generic',
    id: 'generic-priority',
    theme: 'motivation',
    render: () => 'Shall we let the right priority lead today?',
  },
  {
    audience: 'generic',
    id: 'generic-lighten',
    theme: 'momentum',
    render: () => 'Which step makes the rest feel lighter?',
  },
  {
    audience: 'generic',
    id: 'generic-turn',
    theme: 'inspiration',
    render: () => 'Every good turn starts small and precise.',
  },
  {
    audience: 'generic',
    id: 'generic-spark',
    theme: 'inspiration',
    render: () => 'One sharp sentence can change the whole pace.',
  },
  {
    audience: 'generic',
    id: 'generic-seneca',
    theme: 'philosophy',
    render: () => 'Seneca would approve of a calm, precise start.',
  },
  {
    audience: 'generic',
    id: 'generic-descartes',
    theme: 'philosophy',
    render: () => 'Descartes would ask for clarity; I can help with the rest.',
  },
  {
    audience: 'generic',
    id: 'generic-aristotle',
    theme: 'philosophy',
    render: () => 'Aristotle would call it practice; I call it starting.',
  },
  {
    audience: 'location',
    id: 'location-rhythm',
    theme: 'momentum',
    render: ({ locationLabel }) => `How is the pace in ${locationLabel} today?`,
  },
  {
    audience: 'location',
    id: 'location-priority',
    theme: 'inspiration',
    render: ({ locationLabel }) => `What does ${locationLabel} make worth prioritizing now?`,
  },
] as const;

function hashToNumber(seed: string, offset: number): number {
  const hash = crypto.createHash('sha256').update(`${seed}:${offset}`).digest('hex');
  return parseInt(hash.slice(0, 8), 16);
}

export function normalizeRecentHeadlineVariantKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index)
    .slice(0, 4);
}

export function buildNextHeadlineHistory(previous: unknown, nextVariantKey: string): string[] {
  return [nextVariantKey, ...normalizeRecentHeadlineVariantKeys(previous).filter((value) => value !== nextVariantKey)].slice(0, 4);
}

export function resolveHeadlineDayPart(localHour: number): HeadlineDayPart {
  if (localHour >= 5 && localHour < 12) return 'morning';
  if (localHour >= 12 && localHour < 18) return 'afternoon';
  if (localHour >= 18 && localHour < 24) return 'evening';
  return 'night';
}

function resolveTemplates(locale: SupportedHeadlineLocale): readonly HeadlineTemplate[] {
  return locale === 'en-US' ? EN_US_TEMPLATES : PT_BR_TEMPLATES;
}

function normalizeSingleSentence(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function resolveHeadlineName(value?: string | null): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const firstToken = normalized.split(' ').find((token) => token.length > 0) ?? normalized;
  const compactName = firstToken.replace(/[,:;!?]+$/g, '').trim();

  if (compactName.length >= 2 && compactName.length <= 18) {
    return compactName;
  }

  const truncated = compactName.slice(0, 18).trim();
  return truncated.length >= 2 ? truncated : null;
}

function resolveCompactLocationLabel(value?: string | null): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const compact = normalized
    .split(' - ')
    .map((part) => part.trim())
    .find((part) => part.length > 0 && part.length <= 24);

  return compact ?? null;
}

function shouldPreferNamedHeadline(params: {
  displayName?: string | null;
  seed: string;
}): boolean {
  if (!params.displayName) return false;
  return hashToNumber(params.seed, 7) % 10 < 6;
}

function buildCandidates(params: {
  dayPart: HeadlineDayPart;
  displayName?: string | null;
  locale: SupportedHeadlineLocale;
  locationLabel?: string | null;
  recentVariantKeys: string[];
  seed: string;
  templates: readonly HeadlineTemplate[];
}): Array<{
  headline: string;
  theme: HeadlineTheme;
  variantKey: string;
}> {
  const preferredAudience: HeadlineAudience = shouldPreferNamedHeadline({
    displayName: params.displayName,
    seed: `${params.seed}:${params.dayPart}:${params.locale}`,
  }) ? 'named' : 'generic';

  const fallbackAudience = preferredAudience === 'named' ? 'generic' : 'named';
  const templatesByPriority = [
    params.templates.filter((template) => template.audience === preferredAudience),
    params.templates.filter((template) => template.audience === fallbackAudience),
    params.templates.filter((template) => template.audience === 'location'),
  ];

  for (const templateGroup of templatesByPriority) {
    const renderedCandidates = templateGroup
      .map((template) => {
        if (template.audience === 'named' && !params.displayName) return null;
        if (template.audience === 'location' && !params.locationLabel) return null;

        const headline = normalizeSingleSentence(template.render({
          displayName: params.displayName,
          locationLabel: params.locationLabel,
        }));

        if (!headline || headline.length > MAX_HEADLINE_LENGTH) {
          return null;
        }

        return {
          headline,
          theme: template.theme,
          variantKey: `${params.locale}:${params.dayPart}:${template.id}:${template.audience}`,
        };
      })
      .filter((candidate): candidate is {
        headline: string;
        theme: HeadlineTheme;
        variantKey: string;
      } => candidate !== null);

    if (renderedCandidates.length === 0) {
      continue;
    }

    const availableCandidates = renderedCandidates.filter((candidate) => !params.recentVariantKeys.includes(candidate.variantKey));
    return availableCandidates.length > 0 ? availableCandidates : renderedCandidates;
  }

  return [];
}

export function buildChatEmptyStateHeadline(params: BuildChatEmptyStateHeadlineParams): ChatEmptyStateHeadlineResult {
  const dayPart = resolveHeadlineDayPart(params.localHour);
  const templates = resolveTemplates(params.locale);
  const recentKeys = normalizeRecentHeadlineVariantKeys(params.recentVariantKeys);
  const displayName = resolveHeadlineName(params.displayName);
  const locationLabel = resolveCompactLocationLabel(params.locationLabel);
  const candidates = buildCandidates({
    dayPart,
    displayName,
    locale: params.locale,
    locationLabel,
    recentVariantKeys: recentKeys,
    seed: params.seed,
    templates,
  });
  const pool = candidates.length > 0 ? candidates : [{
    headline: params.locale === 'en-US'
      ? 'What deserves your clearest next step?'
      : 'O que merece seu próximo passo mais claro?',
    theme: 'momentum' as const,
    variantKey: `${params.locale}:${dayPart}:fallback:generic`,
  }];
  const index = hashToNumber(`${params.seed}:${recentKeys.join('|')}`, pool.length) % pool.length;
  const selected = pool[index];

  return {
    dayPart,
    headline: selected.headline,
    locale: params.locale,
    theme: selected.theme,
    variantKey: selected.variantKey,
  };
}
