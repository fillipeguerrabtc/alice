import { useState } from 'react';
import type { Control, Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import {
  DETECTOR_LIST_MAX,
  type AgenticSettingsForm,
  type KeywordValidationIssue,
  listToTextarea,
  parseKeywordTextarea,
} from '../types';

type KeywordTextareaFieldProps = {
  control: Control<AgenticSettingsForm>;
  name: string;
  label: string;
  placeholder?: string;
  rows?: number;
  validateRegex?: boolean;
  description?: string;
};

function formatKeywordIssue(issue: KeywordValidationIssue, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (issue.type === 'line_too_long') {
    return t('agenticConfig.keywordErrors.lineTooLong', { line: issue.line, max: 160 });
  }
  if (issue.type === 'invalid_regex') {
    return t('agenticConfig.keywordErrors.invalidRegex', { line: issue.line });
  }
  return t('agenticConfig.keywordErrors.maxItemsExceeded', { max: issue.max });
}

export function KeywordTextareaField({
  control,
  name,
  label,
  placeholder,
  rows = 4,
  validateRegex = false,
  description,
}: KeywordTextareaFieldProps) {
  const { t } = useTranslation();
  const [issues, setIssues] = useState<KeywordValidationIssue[]>([]);

  return (
    <FormField
      control={control}
      name={name as Path<AgenticSettingsForm>}
      render={({ field }) => {
        const value = Array.isArray(field.value)
          ? field.value.filter((item): item is string => typeof item === 'string')
          : [];
        const counter = `${value.length}/${DETECTOR_LIST_MAX}`;
        const firstIssue = issues[0];
        const issueMessage = firstIssue ? formatKeywordIssue(firstIssue, t) : null;

        return (
          <FormItem>
            <div className="flex items-center justify-between gap-2">
              <FormLabel>{label}</FormLabel>
              <span className="text-xs text-muted-foreground">{counter}</span>
            </div>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
            <FormControl>
              <Textarea
                value={listToTextarea(value)}
                onChange={(event) => {
                  const parsed = parseKeywordTextarea(event.target.value, { validateRegex });
                  setIssues(parsed.issues);
                  field.onChange(parsed.items);
                }}
                placeholder={placeholder}
                rows={rows}
              />
            </FormControl>
            {issueMessage ? <p className="text-xs text-destructive">{issueMessage}</p> : null}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
