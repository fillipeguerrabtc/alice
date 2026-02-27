import { z } from 'zod';

export const DETECTOR_LIST_MAX = 200;
export const DETECTOR_ITEM_MAX_LENGTH = 160;

const detectorListSchema = z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX);

export const agenticLinkSchema = z.object({
  id: z.string().min(4),
  name: z.string().min(2),
  url: z.string().url(),
  description: z.string().max(500).optional().nullable(),
  tags: z.array(z.string().min(1)).optional().nullable(),
});

export const detectorGroupSchema = z.object({
  keywords: detectorListSchema,
  patterns: detectorListSchema,
});

export const namespaceRoutingSchema = z.object({
  baseKeywords: detectorListSchema,
  perNamespace: z.record(z.object({
    keywords: detectorListSchema,
    patterns: detectorListSchema,
  })),
  moduleBindings: z.record(detectorListSchema),
});

export const agenticSettingsSchema = z.object({
  webEnabled: z.boolean(),
  erpReadEnabled: z.boolean(),
  erpWriteEnabled: z.boolean(),
  observabilityReadEnabled: z.boolean(),
  observabilityWriteEnabled: z.boolean(),
  tradingEnabled: z.boolean(),
  paymentsEnabled: z.boolean(),
  stackOpsEnabled: z.boolean(),
  financialApprovalRequired: z.boolean(),
  detectors: z.object({
    webSearch: detectorGroupSchema,
    deepWeb: detectorGroupSchema,
    webImageSearch: detectorGroupSchema,
    imageGeneration: detectorGroupSchema,
    trading: detectorGroupSchema,
    agentRouting: z.object({
      manualKeywords: detectorListSchema,
      autoKeywords: detectorListSchema,
    }),
    namespaceRouting: namespaceRoutingSchema,
    grafana: z.object({
      baseKeywords: detectorListSchema,
      listDashboardsKeywords: detectorListSchema,
      updateDashboardKeywords: detectorListSchema,
      getDashboardKeywords: detectorListSchema,
    }),
    agenticTask: z.object({
      createKeywords: detectorListSchema,
      updateKeywords: detectorListSchema,
      intentKeywords: detectorListSchema,
      typeKeywords: z.object({
        document: detectorListSchema,
        report: detectorListSchema,
        accounting: detectorListSchema,
        planning: detectorListSchema,
      }),
    }),
    erp: z.object({
      baseKeywords: detectorListSchema,
      listItemsKeywords: detectorListSchema,
      listCustomersKeywords: detectorListSchema,
      listInvoicesKeywords: detectorListSchema,
      annualBillingKeywords: detectorListSchema,
      createCustomerKeywords: detectorListSchema,
      createInvoiceKeywords: detectorListSchema,
    }),
    payments: z.object({
      wiseKeywords: detectorListSchema,
      wiseRecipientsKeywords: detectorListSchema,
      wiseTransferKeywords: detectorListSchema,
      wiseExchangeKeywords: detectorListSchema,
      stripeKeywords: detectorListSchema,
      stripePaymentKeywords: detectorListSchema,
    }),
    stackOps: z.object({
      baseKeywords: detectorListSchema,
      deployKeywords: detectorListSchema,
      rollbackKeywords: detectorListSchema,
      dryRunKeywords: detectorListSchema,
      smartDeployKeywords: detectorListSchema,
      stackKeywords: detectorListSchema,
    }),
  }),
  platformLinks: z.array(agenticLinkSchema).max(100),
});

export type AgenticSettingsForm = z.infer<typeof agenticSettingsSchema>;

export type AgenticSettingsResponse = {
  settings: AgenticSettingsForm;
  defaults: AgenticSettingsForm;
};

export type AgenticModuleTab =
  | 'overview'
  | 'web'
  | 'images'
  | 'tasks'
  | 'routing'
  | 'namespaces'
  | 'erpnext'
  | 'grafana'
  | 'payments'
  | 'stackOps'
  | 'links'
  | 'trading';

export const AGENTIC_MODULE_TABS: AgenticModuleTab[] = [
  'overview',
  'web',
  'images',
  'tasks',
  'routing',
  'namespaces',
  'erpnext',
  'grafana',
  'payments',
  'stackOps',
  'links',
  'trading',
];

export type KeywordValidationIssue =
  | { type: 'line_too_long'; line: number; length: number }
  | { type: 'invalid_regex'; line: number }
  | { type: 'max_items_exceeded'; max: number };

export type KeywordParseOptions = {
  validateRegex?: boolean;
};

const REGEX_LITERAL_PATTERN = /^\/.+\/[a-z]*$/i;
const VALID_REGEX_FLAGS = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y']);

function isValidRegexLiteral(value: string): boolean {
  if (!REGEX_LITERAL_PATTERN.test(value)) return false;
  const lastSlash = value.lastIndexOf('/');
  if (lastSlash <= 0) return false;
  const flags = value.slice(lastSlash + 1);
  const seen = new Set<string>();
  for (const flag of flags) {
    if (!VALID_REGEX_FLAGS.has(flag) || seen.has(flag)) {
      return false;
    }
    seen.add(flag);
  }
  return true;
}

export function parseKeywordTextarea(input: string, options: KeywordParseOptions = {}): {
  items: string[];
  issues: KeywordValidationIssue[];
} {
  const lines = input.split('\n');
  const items: string[] = [];
  const seen = new Set<string>();
  const issues: KeywordValidationIssue[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) continue;

    if (line.length > DETECTOR_ITEM_MAX_LENGTH) {
      issues.push({ type: 'line_too_long', line: index + 1, length: line.length });
      continue;
    }

    if (options.validateRegex && !isValidRegexLiteral(line)) {
      issues.push({ type: 'invalid_regex', line: index + 1 });
      continue;
    }

    const dedupeKey = line.toLocaleLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    items.push(line);
  }

  if (items.length > DETECTOR_LIST_MAX) {
    issues.push({ type: 'max_items_exceeded', max: DETECTOR_LIST_MAX });
    return {
      items: items.slice(0, DETECTOR_LIST_MAX),
      issues,
    };
  }

  return { items, issues };
}

export function listToTextarea(list?: string[] | null): string {
  return (list ?? []).join('\n');
}

export type NamespaceItem = {
  id: string;
  nome: string;
  slug: string;
};

function removeDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

export function buildNamespaceKeywordDefaults(namespace: NamespaceItem): string[] {
  const rawValues = [
    namespace.slug,
    namespace.nome,
    removeDiacritics(namespace.nome),
    `namespace ${namespace.slug}`,
    `time ${namespace.nome}`,
    `squad ${namespace.nome}`,
    `area ${namespace.nome}`,
    `departamento ${namespace.nome}`,
  ];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of rawValues) {
    const item = value.trim();
    if (!item) continue;
    const key = item.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }
  return normalized;
}

export function buildAgenticDefaultValues(): AgenticSettingsForm {
  return {
    webEnabled: true,
    erpReadEnabled: true,
    erpWriteEnabled: true,
    observabilityReadEnabled: true,
    observabilityWriteEnabled: true,
    tradingEnabled: true,
    paymentsEnabled: true,
    stackOpsEnabled: true,
    financialApprovalRequired: true,
    detectors: {
      webSearch: { keywords: [], patterns: [] },
      deepWeb: { keywords: [], patterns: [] },
      webImageSearch: { keywords: [], patterns: [] },
      imageGeneration: { keywords: [], patterns: [] },
      trading: { keywords: [], patterns: [] },
      agentRouting: { manualKeywords: [], autoKeywords: [] },
      namespaceRouting: {
        baseKeywords: [],
        perNamespace: {},
        moduleBindings: {
          web: [],
          images: [],
          tasks: [],
          routing: [],
          erpnext: [],
          grafana: [],
          payments: [],
          stackOps: [],
          trading: [],
        },
      },
      grafana: {
        baseKeywords: [],
        listDashboardsKeywords: [],
        updateDashboardKeywords: [],
        getDashboardKeywords: [],
      },
      agenticTask: {
        createKeywords: [],
        updateKeywords: [],
        intentKeywords: [],
        typeKeywords: {
          document: [],
          report: [],
          accounting: [],
          planning: [],
        },
      },
      erp: {
        baseKeywords: [],
        listItemsKeywords: [],
        listCustomersKeywords: [],
        listInvoicesKeywords: [],
        annualBillingKeywords: [],
        createCustomerKeywords: [],
        createInvoiceKeywords: [],
      },
      payments: {
        wiseKeywords: [],
        wiseRecipientsKeywords: [],
        wiseTransferKeywords: [],
        wiseExchangeKeywords: [],
        stripeKeywords: [],
        stripePaymentKeywords: [],
      },
      stackOps: {
        baseKeywords: [],
        deployKeywords: [],
        rollbackKeywords: [],
        dryRunKeywords: [],
        smartDeployKeywords: [],
        stackKeywords: [],
      },
    },
    platformLinks: [],
  };
}
