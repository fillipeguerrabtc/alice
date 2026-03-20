import crypto from 'node:crypto';

type SupportedHeadlineLocale = 'pt-BR' | 'en-US';
type HeadlineDayPart = 'morning' | 'afternoon' | 'evening' | 'night';
type HeadlineTheme = 'create' | 'work' | 'organize' | 'day_check' | 'start_task' | 'resume';

type HeadlineTemplate = {
  id: string;
  theme: HeadlineTheme;
  render: (params: { locationLabel?: string | null }) => string;
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

const PT_BR_TEMPLATES: readonly HeadlineTemplate[] = [
  {
    id: 'create-shape',
    theme: 'create',
    render: () => 'Vamos dar forma a uma ideia que merece sair do rascunho hoje?',
  },
  {
    id: 'create-move',
    theme: 'create',
    render: () => 'Qual criação você quer colocar em movimento agora?',
  },
  {
    id: 'work-clarity',
    theme: 'work',
    render: () => 'O que no trabalho pede mais clareza e menos atrito agora?',
  },
  {
    id: 'work-unblock',
    theme: 'work',
    render: () => 'Qual frente vale destravar com mais confiança hoje?',
  },
  {
    id: 'organize-next-step',
    theme: 'organize',
    render: () => 'Quer organizar as ideias para enxergar o próximo passo com calma?',
  },
  {
    id: 'organize-plan',
    theme: 'organize',
    render: () => 'Vamos alinhar o que está na sua cabeça para virar plano?',
  },
  {
    id: 'day-check',
    theme: 'day_check',
    render: ({ locationLabel }) => locationLabel
      ? `Como está o ritmo por aí em ${locationLabel} e o que vale priorizar agora?`
      : 'Como está o seu dia e o que precisa ganhar prioridade agora?',
  },
  {
    id: 'start-task',
    theme: 'start_task',
    render: () => 'Vamos começar a tarefa que faz o restante do dia andar melhor?',
  },
  {
    id: 'start-weight',
    theme: 'start_task',
    render: () => 'Qual tarefa vale iniciar antes que ela pese mais depois?',
  },
  {
    id: 'resume-important',
    theme: 'resume',
    render: () => 'Quer retomar o que ficou importante sem perder o ritmo?',
  },
  {
    id: 'resume-center',
    theme: 'resume',
    render: () => 'Vamos trazer de volta ao centro o que merece atenção agora?',
  },
] as const;

const EN_US_TEMPLATES: readonly HeadlineTemplate[] = [
  {
    id: 'create-shape',
    theme: 'create',
    render: () => 'What idea feels ready to move out of draft mode today?',
  },
  {
    id: 'create-move',
    theme: 'create',
    render: () => 'What would you like to start creating right now?',
  },
  {
    id: 'work-clarity',
    theme: 'work',
    render: () => 'What part of work needs more clarity and less friction right now?',
  },
  {
    id: 'work-unblock',
    theme: 'work',
    render: () => 'What should we unblock first to make today lighter?',
  },
  {
    id: 'organize-next-step',
    theme: 'organize',
    render: () => 'Want to organize your thoughts and make the next step clearer?',
  },
  {
    id: 'organize-plan',
    theme: 'organize',
    render: () => 'Shall we turn what is on your mind into a cleaner plan?',
  },
  {
    id: 'day-check',
    theme: 'day_check',
    render: ({ locationLabel }) => locationLabel
      ? `How is the pace in ${locationLabel}, and what deserves priority now?`
      : 'How is your day going, and what deserves priority now?',
  },
  {
    id: 'start-task',
    theme: 'start_task',
    render: () => 'What task is worth starting before the rest of the day gets louder?',
  },
  {
    id: 'start-weight',
    theme: 'start_task',
    render: () => 'Shall we start the task that will make the rest of the day easier?',
  },
  {
    id: 'resume-important',
    theme: 'resume',
    render: () => 'Want to pick up what still matters without losing momentum?',
  },
  {
    id: 'resume-center',
    theme: 'resume',
    render: () => 'What important thread should we bring back to the center now?',
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

function buildGreetingPrefix(params: {
  dayPart: HeadlineDayPart;
  displayName?: string | null;
  locale: SupportedHeadlineLocale;
}): string | null {
  const name = params.displayName?.trim();
  if (!name) return null;

  if (params.locale === 'en-US') {
    switch (params.dayPart) {
      case 'morning':
        return `Good morning, ${name}, `;
      case 'afternoon':
        return `Good afternoon, ${name}, `;
      case 'evening':
        return `Good evening, ${name}, `;
      default:
        return `Hi, ${name}, `;
    }
  }

  switch (params.dayPart) {
    case 'morning':
      return `Bom dia, ${name}, `;
    case 'afternoon':
      return `Boa tarde, ${name}, `;
    case 'evening':
      return `Boa noite, ${name}, `;
    default:
      return `Oi, ${name}, `;
  }
}

function resolveTemplates(locale: SupportedHeadlineLocale): readonly HeadlineTemplate[] {
  return locale === 'en-US' ? EN_US_TEMPLATES : PT_BR_TEMPLATES;
}

function normalizeSingleSentence(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function buildChatEmptyStateHeadline(params: BuildChatEmptyStateHeadlineParams): ChatEmptyStateHeadlineResult {
  const dayPart = resolveHeadlineDayPart(params.localHour);
  const templates = resolveTemplates(params.locale);
  const recentKeys = normalizeRecentHeadlineVariantKeys(params.recentVariantKeys);
  const greetingPrefix = buildGreetingPrefix({
    dayPart,
    displayName: params.displayName,
    locale: params.locale,
  });
  const greetingVariants = greetingPrefix ? [false, false, false, true] : [false];

  const candidates = templates.flatMap((template) => greetingVariants.map((useGreeting) => {
    const headline = normalizeSingleSentence(
      `${useGreeting ? greetingPrefix ?? '' : ''}${template.render({ locationLabel: params.locationLabel })}`
    );

    return {
      headline,
      theme: template.theme,
      variantKey: `${params.locale}:${dayPart}:${template.id}:${useGreeting ? 'greet' : 'plain'}:${params.locationLabel ? 'loc' : 'std'}`,
    };
  }));

  const candidateCount = candidates.length;
  const availableCandidates = candidates.filter((candidate) => !recentKeys.includes(candidate.variantKey));
  const pool = availableCandidates.length > 0 ? availableCandidates : candidates;
  const index = hashToNumber(`${params.seed}:${recentKeys.join('|')}`, candidateCount) % pool.length;
  const selected = pool[index];

  return {
    dayPart,
    headline: selected.headline,
    locale: params.locale,
    theme: selected.theme,
    variantKey: selected.variantKey,
  };
}
