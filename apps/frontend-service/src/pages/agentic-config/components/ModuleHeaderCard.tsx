import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type ModuleHeaderCardProps = {
  title: string;
  description: string;
  examples?: string[];
  practices?: string[];
  examplesTitle?: string;
  practicesTitle?: string;
  onRestoreDefaults: () => void;
  restoreLabel: string;
};

export function ModuleHeaderCard({
  title,
  description,
  examples = [],
  practices = [],
  examplesTitle = 'Exemplos prontos',
  practicesTitle = 'Boas práticas',
  onRestoreDefaults,
  restoreLabel,
}: ModuleHeaderCardProps) {
  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onRestoreDefaults}>
            {restoreLabel}
          </Button>
        </div>
      </CardHeader>
      {(examples.length > 0 || practices.length > 0) ? (
        <CardContent className="space-y-4">
          {examples.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">{examplesTitle}</h4>
              <div className="grid gap-2 md:grid-cols-2">
                {examples.map((example) => (
                  <div key={example} className="rounded-md border bg-muted/40 px-3 py-2 text-xs font-mono">
                    {example}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {practices.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">{practicesTitle}</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {practices.map((practice) => (
                  <li key={practice}>• {practice}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
