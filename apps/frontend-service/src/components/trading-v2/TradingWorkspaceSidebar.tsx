import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { TradingWorkspaceQuickActionSection } from './types';

type TradingWorkspaceSidebarProps = {
  className?: string;
  compact?: boolean;
  sections: TradingWorkspaceQuickActionSection[];
};

export function TradingWorkspaceSidebar({
  className,
  compact = false,
  sections,
}: TradingWorkspaceSidebarProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {sections.map((section) => (
        <Card key={section.id} className="border-border/60 shadow-sm">
          <CardHeader className={cn(compact ? 'pb-3' : 'pb-4')}>
            <CardTitle className="text-sm font-semibold">{section.title}</CardTitle>
            {section.description ? (
              <CardDescription className="text-xs">{section.description}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className={cn('space-y-2', compact ? 'pt-0' : '')}>
            {section.actions.map((action) => (
              <Button
                key={action.id}
                type="button"
                variant="ghost"
                className="h-auto w-full justify-start px-2 py-2 text-left"
                onClick={action.onSelect}
                disabled={action.disabled}
                data-testid={action.testId}
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{action.label}</span>
                  {action.description ? (
                    <span className="text-xs text-muted-foreground">{action.description}</span>
                  ) : null}
                </span>
              </Button>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
