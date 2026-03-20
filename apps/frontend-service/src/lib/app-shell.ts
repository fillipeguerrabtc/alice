export type AppShellMode = 'platform' | 'feature';

export type AppShellState = {
  featureRoot: string | null;
  lockViewport: boolean;
  mode: AppShellMode;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

type RouteShellRule = {
  featureRoot: string;
  lockViewport: boolean;
  pattern: RegExp;
};

const FEATURE_ROUTE_RULES: RouteShellRule[] = [
  {
    featureRoot: '/chat',
    lockViewport: true,
    pattern: /^\/chat(\/|$)/,
  },
  {
    featureRoot: '/chat',
    lockViewport: true,
    pattern: /^\/conversations(\/|$)/,
  },
  {
    featureRoot: '/trading',
    lockViewport: false,
    pattern: /^\/trading(\/|$)/,
  },
  {
    featureRoot: '/demo-trading',
    lockViewport: false,
    pattern: /^\/demo-trading(\/|$)/,
  },
];

export function normalizeAppPathname(pathname: string): string {
  if (!pathname) return '/';
  const normalized = pathname.split('?')[0]?.split('#')[0]?.trim() || '/';
  if (!normalized.startsWith('/')) {
    return `/${normalized}`;
  }
  return normalized || '/';
}

export function readStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;
  const navigatorStandalone = (window.navigator as NavigatorWithStandalone).standalone === true;
  const standaloneMediaQuery = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const minimalUiMediaQuery = window.matchMedia?.('(display-mode: minimal-ui)').matches ?? false;

  return navigatorStandalone || standaloneMediaQuery || minimalUiMediaQuery;
}

export function resolveAppShellState(pathname: string, isStandalone: boolean): AppShellState {
  const normalizedPathname = normalizeAppPathname(pathname);

  if (!isStandalone || normalizedPathname === '/' || normalizedPathname.startsWith('/login')) {
    return {
      featureRoot: null,
      lockViewport: normalizedPathname.startsWith('/chat'),
      mode: 'platform',
    };
  }

  const matchedRule = FEATURE_ROUTE_RULES.find(({ pattern }) => pattern.test(normalizedPathname));
  if (matchedRule) {
    return {
      featureRoot: matchedRule.featureRoot,
      lockViewport: matchedRule.lockViewport,
      mode: 'feature',
    };
  }

  const firstSegment = normalizedPathname.split('/').filter(Boolean)[0];

  return {
    featureRoot: firstSegment ? `/${firstSegment}` : null,
    lockViewport: false,
    mode: 'feature',
  };
}
