import { useQuery, useMutation } from '@tanstack/react-query';
import { Plug, CreditCard, Mail, MessageSquare, Database, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';

interface Integration {
  id: string;
  tipo: string;
  nome: string;
  ativo: boolean;
  criadoEm: string;
}

const availableIntegrations = [
  {
    tipo: 'stripe',
    nome: 'Stripe',
    description: 'Pagamentos e subscriptions',
    icon: CreditCard,
  },
  {
    tipo: 'erpnext',
    nome: 'ERPNext',
    description: 'ERP e gestão empresarial',
    icon: Database,
  },
  {
    tipo: 'resend',
    nome: 'Resend',
    description: 'Envio de emails transacionais',
    icon: Mail,
  },
  {
    tipo: 'whatsapp',
    nome: 'WhatsApp Business',
    description: 'Mensagens via WhatsApp',
    icon: MessageSquare,
  },
];

export default function Integrations() {
  const { data, isLoading } = useQuery<{ integrations: Integration[] }>({
    queryKey: ['/api/integrations'],
  });

  const { data: healthData } = useQuery<{ integrations: Record<string, boolean> }>({
    queryKey: ['/api/integrations/health'],
  });

  const createMutation = useMutation({
    mutationFn: async (tipo: string) => {
      const integration = availableIntegrations.find((i) => i.tipo === tipo);
      const res = await apiRequest('POST', '/api/integrations', {
        tipo,
        nome: integration?.nome || tipo,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
      toast({ title: 'Integração criada com sucesso' });
    },
    onError: () => {
      toast({ title: 'Erro ao criar integração', variant: 'destructive' });
    },
  });

  const activeIntegrations = data?.integrations || [];
  const activeTypes = new Set(activeIntegrations.map((i) => i.tipo));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
          Integrações
        </h1>
        <p className="text-muted-foreground">
          Conecte a Alice a serviços externos e sistemas empresariais
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {availableIntegrations.map((integration) => {
          const isActive = activeTypes.has(integration.tipo);
          const isHealthy = healthData?.integrations?.[integration.tipo];

          return (
            <Card
              key={integration.tipo}
              className="hover-elevate"
              data-testid={`card-integration-${integration.tipo}`}
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <integration.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{integration.nome}</CardTitle>
                      <CardDescription>{integration.description}</CardDescription>
                    </div>
                  </div>
                  {isActive && (
                    <span
                      className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
                        isHealthy
                          ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                          : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                      }`}
                    >
                      {isHealthy ? (
                        <>
                          <Check className="h-3 w-3" /> Conectado
                        </>
                      ) : (
                        <>
                          <X className="h-3 w-3" /> Pendente
                        </>
                      )}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <Button
                  variant={isActive ? 'outline' : 'default'}
                  className="w-full"
                  onClick={() => !isActive && createMutation.mutate(integration.tipo)}
                  disabled={createMutation.isPending}
                  data-testid={`button-${isActive ? 'configure' : 'connect'}-${integration.tipo}`}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plug className="h-4 w-4 mr-2" />
                  )}
                  {isActive ? 'Configurar' : 'Conectar'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : activeIntegrations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Integrações Ativas</CardTitle>
            <CardDescription>
              Gerencie suas integrações configuradas
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {activeIntegrations.map((integration) => (
                <div
                  key={integration.id}
                  className="flex items-center justify-between gap-4 p-3 border rounded-md"
                >
                  <div>
                    <p className="font-medium">{integration.nome}</p>
                    <p className="text-sm text-muted-foreground">{integration.tipo}</p>
                  </div>
                  <Button variant="outline" size="sm">
                    Configurar
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
