import { z } from 'zod';

export const PrivacyRuleSchema = z.object({
  id: z.string().min(1).max(120),
  action: z.enum(['redact', 'quarantine', 'reject']),
  pattern: z.string().min(1).max(2000),
  flags: z.string().max(16).optional(),
  replacement: z.string().max(500).optional(),
  label: z.string().max(120).optional(),
}).passthrough();

export const PrivacyConfigSchema = z.object({
  enabled: z.boolean(),
  rules: z.array(PrivacyRuleSchema),
  logRedactionSummary: z.boolean(),
}).passthrough();

type MessageLike = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type PrivacyAction = 'allow' | 'quarantine' | 'reject';

export function applyPrivacyPolicy(params: {
  messages: MessageLike[];
  privacyConfig: z.infer<typeof PrivacyConfigSchema>;
}): {
  messagesRedacted: MessageLike[];
  flags: Array<{ ruleId: string; label?: string; action: 'redact' | 'quarantine' | 'reject'; matches: number }>;
  action: PrivacyAction;
  summary: { redactedRules: number; quarantinedRules: number; rejectedRules: number; totalMatches: number };
} {
  const parsedConfig = PrivacyConfigSchema.parse(params.privacyConfig);
  if (!parsedConfig.enabled || parsedConfig.rules.length === 0) {
    return {
      messagesRedacted: params.messages,
      flags: [],
      action: 'allow',
      summary: { redactedRules: 0, quarantinedRules: 0, rejectedRules: 0, totalMatches: 0 },
    };
  }

  const messagesRedacted = params.messages.map((message) => ({ ...message }));
  const flags: Array<{ ruleId: string; label?: string; action: 'redact' | 'quarantine' | 'reject'; matches: number }> = [];

  let quarantine = false;
  let reject = false;
  let totalMatches = 0;
  let redactedRules = 0;
  let quarantinedRules = 0;
  let rejectedRules = 0;

  for (const rule of parsedConfig.rules) {
    let regex: RegExp;
    try {
      regex = new RegExp(rule.pattern, rule.flags);
    } catch {
      continue;
    }

    let matches = 0;
    for (let index = 0; index < messagesRedacted.length; index += 1) {
      const item = messagesRedacted[index];
      const content = item.content ?? '';
      const found = content.match(regex);
      if (!found || found.length === 0) continue;
      matches += found.length;
      if (rule.action === 'redact') {
        const replacement = rule.replacement ?? '[REDACTED]';
        messagesRedacted[index] = { ...item, content: content.replace(regex, replacement) };
      }
    }

    if (matches <= 0) continue;

    totalMatches += matches;
    flags.push({
      ruleId: rule.id,
      label: rule.label,
      action: rule.action,
      matches,
    });

    if (rule.action === 'redact') redactedRules += 1;
    if (rule.action === 'quarantine') {
      quarantine = true;
      quarantinedRules += 1;
    }
    if (rule.action === 'reject') {
      reject = true;
      rejectedRules += 1;
    }
  }

  const action: PrivacyAction = reject ? 'reject' : quarantine ? 'quarantine' : 'allow';
  return {
    messagesRedacted,
    flags,
    action,
    summary: {
      redactedRules,
      quarantinedRules,
      rejectedRules,
      totalMatches,
    },
  };
}
