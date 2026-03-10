import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type WiseCardOrdersJsonActionBlockProps = {
  buttonLabelKey: string;
  isPending: boolean;
  labelKey: string;
  onSubmit: () => void;
  setValue: (value: string) => void;
  t: TFunction;
  testIdButton: string;
  testIdTextarea: string;
  value: string;
};

export function WiseCardOrdersJsonActionBlock({
  buttonLabelKey,
  isPending,
  labelKey,
  onSubmit,
  setValue,
  t,
  testIdButton,
  testIdTextarea,
  value,
}: WiseCardOrdersJsonActionBlockProps) {
  return (
    <div className="space-y-2">
      <Label>{t(labelKey)}</Label>
      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={4}
        placeholder="{ }"
        data-testid={testIdTextarea}
      />
      <Button onClick={onSubmit} disabled={isPending} data-testid={testIdButton}>
        {t(buttonLabelKey)}
      </Button>
    </div>
  );
}
