import type { Control } from 'react-hook-form';
import { Separator } from '@/components/ui/separator';
import { KeywordTextareaField } from './KeywordTextareaField';
import type { AgenticSettingsForm } from '../types';

export type DetectorFieldDefinition = {
  name: string;
  label: string;
  placeholder?: string;
  validateRegex?: boolean;
  rows?: number;
  description?: string;
};

type DetectorGroupEditorProps = {
  control: Control<AgenticSettingsForm>;
  title: string;
  description?: string;
  fields: DetectorFieldDefinition[];
};

export function DetectorGroupEditor({ control, title, description, fields }: DetectorGroupEditorProps) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-4">
        {fields.map((field) => (
          <KeywordTextareaField
            key={field.name}
            control={control}
            name={field.name}
            label={field.label}
            placeholder={field.placeholder}
            validateRegex={field.validateRegex}
            rows={field.rows}
            description={field.description}
          />
        ))}
      </div>
      <Separator />
    </section>
  );
}
