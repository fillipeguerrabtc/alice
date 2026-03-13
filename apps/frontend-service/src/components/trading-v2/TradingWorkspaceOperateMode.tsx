import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

type TradingWorkspaceOperateModeProps = {
  advancedDisclosure: ReactNode;
  chartArea: ReactNode;
  openOrdersPanel: ReactNode;
  openPositionsPanel: ReactNode;
  orderTicket: ReactNode;
  statusCard: ReactNode;
};

export function TradingWorkspaceOperateMode({
  advancedDisclosure,
  chartArea,
  openOrdersPanel,
  openPositionsPanel,
  orderTicket,
  statusCard,
}: TradingWorkspaceOperateModeProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Main Chart Area</CardTitle>
            <CardDescription>Visão principal de mercado para decisão de execução.</CardDescription>
          </CardHeader>
          <CardContent>{chartArea}</CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Compact Order Ticket</CardTitle>
              <CardDescription>Entrada rápida para ordens de execução.</CardDescription>
            </CardHeader>
            <CardContent>{orderTicket}</CardContent>
          </Card>
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Status Operacional</CardTitle>
              <CardDescription>WebSocket, engine, risco e circuit breaker.</CardDescription>
            </CardHeader>
            <CardContent>{statusCard}</CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Open Positions</CardTitle>
          </CardHeader>
          <CardContent>{openPositionsPanel}</CardContent>
        </Card>
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Open Orders</CardTitle>
          </CardHeader>
          <CardContent>{openOrdersPanel}</CardContent>
        </Card>
      </div>

      <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Advanced Account & Risk</CardTitle>
                <CardDescription>Detalhes avançados fora da primeira dobra.</CardDescription>
              </div>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="outline" size="sm" data-testid="operate-v2-advanced-toggle">
                  {isAdvancedOpen ? 'Recolher' : 'Expandir'}
                  {isAdvancedOpen ? (
                    <ChevronUp className="ml-1 h-4 w-4" />
                  ) : (
                    <ChevronDown className="ml-1 h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
            </div>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>{advancedDisclosure}</CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
