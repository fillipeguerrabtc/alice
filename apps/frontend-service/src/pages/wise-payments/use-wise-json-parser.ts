import { useCallback } from 'react';

type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

type UseWiseJsonParserOptions = {
  notify: NotifyFn;
};

export function useWiseJsonParser(options: UseWiseJsonParserOptions) {
  const { notify } = options;

  const parseJsonSafe = useCallback((raw: string, errorTitle: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      notify({
        title: errorTitle,
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
      return null;
    }
  }, [notify]);

  return {
    parseJsonSafe,
  };
}
