import { useEffect, useState } from 'react';
import { readStandaloneDisplayMode } from '@/lib/app-shell';

export function useStandaloneDisplayMode() {
  const [isStandalone, setIsStandalone] = useState(() => readStandaloneDisplayMode());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const syncDisplayMode = () => {
      setIsStandalone(readStandaloneDisplayMode());
    };

    const mediaQueries = [
      window.matchMedia?.('(display-mode: standalone)'),
      window.matchMedia?.('(display-mode: minimal-ui)'),
    ].filter((value): value is MediaQueryList => Boolean(value));

    syncDisplayMode();

    mediaQueries.forEach((query) => query.addEventListener('change', syncDisplayMode));
    window.addEventListener('focus', syncDisplayMode);
    window.addEventListener('pageshow', syncDisplayMode);
    document.addEventListener('visibilitychange', syncDisplayMode);

    return () => {
      mediaQueries.forEach((query) => query.removeEventListener('change', syncDisplayMode));
      window.removeEventListener('focus', syncDisplayMode);
      window.removeEventListener('pageshow', syncDisplayMode);
      document.removeEventListener('visibilitychange', syncDisplayMode);
    };
  }, []);

  return isStandalone;
}
