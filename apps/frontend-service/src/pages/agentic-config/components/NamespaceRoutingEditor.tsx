import type { UseFormReturn } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/queryClient';
import {
  buildNamespaceKeywordDefaults,
  type AgenticModuleTab,
  type AgenticSettingsForm,
  type NamespaceItem,
} from '../types';
import { KeywordTextareaField } from './KeywordTextareaField';

type NamespaceRoutingEditorProps = {
  form: UseFormReturn<AgenticSettingsForm>;
  defaults: AgenticSettingsForm['detectors']['namespaceRouting'];
};

type ModuleNamespaceBindingsEditorProps = {
  form: UseFormReturn<AgenticSettingsForm>;
  moduleKey: Extract<AgenticModuleTab, 'web' | 'images' | 'tasks' | 'routing' | 'grafana' | 'payments' | 'stackOps' | 'trading'>;
  title: string;
  description: string;
};

export function useNamespacesQuery() {
  return useQuery<NamespaceItem[]>({
    queryKey: ['/api/namespaces'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/namespaces');
      return response.json();
    },
  });
}

function normalizeNamespaceSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function ModuleNamespaceBindingsEditor({
  form,
  moduleKey,
  title,
  description,
}: ModuleNamespaceBindingsEditorProps) {
  const { t } = useTranslation();
  const namespacesQuery = useNamespacesQuery();
  const bindingPath = `detectors.namespaceRouting.moduleBindings.${moduleKey}` as const;
  const selectedNamespaces = (form.watch(bindingPath) ?? []) as string[];

  if (namespacesQuery.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const namespaces = namespacesQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {namespaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('agenticConfig.namespaces.empty')}</p>
        ) : null}
        {namespaces.map((namespace) => {
          const slug = normalizeNamespaceSlug(namespace.slug || namespace.nome);
          const checked = selectedNamespaces.includes(slug);
          return (
            <label key={namespace.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <Checkbox
                checked={checked}
                onCheckedChange={(state) => {
                  const isChecked = state === true;
                  const current = new Set(selectedNamespaces);
                  if (isChecked) {
                    current.add(slug);
                  } else {
                    current.delete(slug);
                  }
                  form.setValue(bindingPath, Array.from(current), { shouldDirty: true, shouldValidate: true });
                }}
              />
              <span className="text-sm font-medium">{namespace.nome}</span>
              <span className="text-xs text-muted-foreground">/{namespace.slug}</span>
            </label>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function NamespaceRoutingEditor({ form, defaults }: NamespaceRoutingEditorProps) {
  const { t } = useTranslation();
  const namespacesQuery = useNamespacesQuery();

  return (
    <div className="space-y-6">
      <KeywordTextareaField
        control={form.control}
        name="detectors.namespaceRouting.baseKeywords"
        label={t('agenticConfig.namespaces.baseKeywords')}
        placeholder={t('agenticConfig.namespaces.baseKeywordsPlaceholder')}
        rows={4}
      />

      {namespacesQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {(namespacesQuery.data ?? []).map((namespace) => {
        const slug = normalizeNamespaceSlug(namespace.slug || namespace.nome);
        const defaultsForNamespace = defaults.perNamespace?.[slug] ?? { keywords: [], patterns: [] };
        return (
          <Card key={namespace.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{namespace.nome}</CardTitle>
                  <CardDescription>/{namespace.slug}</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const generated = buildNamespaceKeywordDefaults(namespace);
                      form.setValue(`detectors.namespaceRouting.perNamespace.${slug}.keywords`, generated, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }}
                  >
                    {t('agenticConfig.namespaces.generateDefaults')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      form.setValue(`detectors.namespaceRouting.perNamespace.${slug}.keywords`, defaultsForNamespace.keywords ?? [], {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      form.setValue(`detectors.namespaceRouting.perNamespace.${slug}.patterns`, defaultsForNamespace.patterns ?? [], {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }}
                  >
                    {t('agenticConfig.namespaces.resetNamespaceDefaults')}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <KeywordTextareaField
                control={form.control}
                name={`detectors.namespaceRouting.perNamespace.${slug}.keywords`}
                label={t('agenticConfig.namespaces.namespaceKeywords')}
                placeholder={t('agenticConfig.namespaces.namespaceKeywordsPlaceholder')}
                rows={4}
              />
              <KeywordTextareaField
                control={form.control}
                name={`detectors.namespaceRouting.perNamespace.${slug}.patterns`}
                label={t('agenticConfig.namespaces.namespacePatterns')}
                placeholder={t('agenticConfig.namespaces.namespacePatternsPlaceholder')}
                rows={3}
                validateRegex
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
