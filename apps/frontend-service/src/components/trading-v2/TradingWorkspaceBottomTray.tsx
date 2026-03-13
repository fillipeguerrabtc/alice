import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { TradingWorkspaceQuickActionSection } from './types';

type TradingWorkspaceBottomTrayProps = {
  sections: TradingWorkspaceQuickActionSection[];
};

export function TradingWorkspaceBottomTray({ sections }: TradingWorkspaceBottomTrayProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold">Painel inferior colapsável</CardTitle>
              <CardDescription className="text-xs">
                Ações avançadas ficam fora da navegação principal por progressive disclosure.
              </CardDescription>
            </div>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="outline" size="sm" data-testid="workspace-v2-bottom-tray-toggle">
                {open ? (
                  <>
                    Recolher
                    <ChevronUp className="ml-1 h-4 w-4" />
                  </>
                ) : (
                  <>
                    Expandir
                    <ChevronDown className="ml-1 h-4 w-4" />
                  </>
                )}
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="grid gap-3 pt-0 md:grid-cols-2 xl:grid-cols-3">
            {sections.map((section) => (
              <div key={section.id} className="rounded-lg border p-3">
                <p className="text-sm font-semibold">{section.title}</p>
                {section.description ? (
                  <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
                ) : null}
                <div className="mt-3 space-y-2">
                  {section.actions.map((action) => (
                    <Button
                      key={action.id}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto w-full justify-start px-2 py-1.5 text-left"
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
                </div>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
