import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Bot,
  Plus,
  MoreHorizontal,
  Trash2,
  Edit,
  Power,
  MessageSquare,
  Briefcase,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface Agent {
  id: string;
  namespaceId: string | null;
  nome: string;
  slug: string;
  descricao: string | null;
  avatar: string | null;
  personalidade: string | null;
  instrucoes: string | null;
  capacidades: string[] | null;
  modeloBase: string | null;
  temperaturaModelo: number | null;
  maxTokens: number | null;
  status: 'active' | 'training' | 'paused' | 'deprecated' | null;
  metricas: unknown;
  versao: number | null;
  criadoEm: Date | null;
  atualizadoEm: Date | null;
}

const statusOptionsConfig = [
  { value: "active", icon: Power, color: "text-green-500", labelKey: "agents.status.active" },
  { value: "training", icon: Bot, color: "text-blue-500", labelKey: "agents.status.training" },
  { value: "paused", icon: MessageSquare, color: "text-orange-500", labelKey: "agents.status.paused" },
  { value: "deprecated", icon: Briefcase, color: "text-muted-foreground", labelKey: "agents.status.deprecated" },
];

type AgentFormData = {
  nome: string;
  slug: string;
  descricao?: string | null;
  instrucoes?: string | null;
  personalidade?: string | null;
  status: "active" | "training" | "paused" | "deprecated";
};

const agentFormSchema = z.object({
  nome: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  descricao: z.string().optional().nullable(),
  instrucoes: z.string().optional().nullable(),
  personalidade: z.string().optional().nullable(),
  status: z.enum(["active", "training", "paused", "deprecated"]).default("active"),
});

function AgentCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <Skeleton className="h-5 w-16" />
        </div>
        <Skeleton className="h-5 w-32 mb-2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4 mt-1" />
      </CardContent>
    </Card>
  );
}

export default function Agents() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const statusOptions = statusOptionsConfig.map(opt => ({
    ...opt,
    label: t(opt.labelKey)
  }));

  const form = useForm<AgentFormData>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      nome: "",
      slug: "",
      descricao: "",
      instrucoes: "",
      personalidade: "",
      status: "active",
    },
  });

  const { data: agents, isLoading } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    enabled: !!user,
  });

  const createAgentMutation = useMutation({
    mutationFn: async (data: AgentFormData) => {
      const res = await apiRequest("POST", "/api/agents", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({ title: t('agents.success.created') });
      setIsDialogOpen(false);
      form.reset();
    },
    onError: () => {
      toast({ title: t('agents.errors.create'), variant: "destructive" });
    },
  });

  const updateAgentMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<AgentFormData> }) => {
      const res = await apiRequest("PATCH", `/api/agents/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({ title: t('agents.success.updated') });
      setIsDialogOpen(false);
      setEditingAgent(null);
      form.reset();
    },
    onError: () => {
      toast({ title: t('agents.errors.update'), variant: "destructive" });
    },
  });

  const deleteAgentMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/agents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({ title: t('agents.success.removed') });
    },
    onError: () => {
      toast({ title: t('agents.errors.remove'), variant: "destructive" });
    },
  });

  const toggleAgentMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'paused' }) => {
      const res = await apiRequest("PATCH", `/api/agents/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
    },
  });

  const handleSubmit = (data: AgentFormData) => {
    if (editingAgent) {
      updateAgentMutation.mutate({ id: editingAgent.id, data });
    } else {
      createAgentMutation.mutate(data);
    }
  };

  const handleEdit = (agent: Agent) => {
    setEditingAgent(agent);
    form.reset({
      nome: agent.nome,
      slug: agent.slug,
      descricao: agent.descricao || "",
      instrucoes: agent.instrucoes || "",
      personalidade: agent.personalidade || "",
      status: agent.status || "active",
    });
    setIsDialogOpen(true);
  };

  const handleNewAgent = () => {
    setEditingAgent(null);
    form.reset();
    setIsDialogOpen(true);
  };

  const getStatusInfo = (status: string) => {
    return statusOptions.find((s) => s.value === status) || statusOptions[0];
  };

  const activeAgents = agents?.filter((a) => a.status === 'active').length || 0;
  const totalAgents = agents?.length || 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
            {t('agents.title')}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t('agents.subtitle', { active: activeAgents, total: totalAgents })}
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleNewAgent} data-testid="button-criar-agente">
              <Plus className="mr-2 h-4 w-4" />
              {t('agents.create')}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>
                {editingAgent ? t('agents.form.dialogTitleEdit') : t('agents.form.dialogTitle')}
              </DialogTitle>
              <DialogDescription>
                {t('agents.form.dialogDesc')}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="nome"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agents.form.name')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('agents.placeholders.name')}
                          {...field}
                          data-testid="input-agente-nome"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agents.form.slug')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('agents.placeholders.slug')}
                          {...field}
                          data-testid="input-agente-slug"
                        />
                      </FormControl>
                      <FormDescription>
                        {t('agents.form.slugDesc')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agents.status.label')}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-agente-status">
                            <SelectValue placeholder={t('agents.status.selectPlaceholder')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {statusOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="descricao"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agents.form.description')}</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t('agents.placeholders.description')}
                          className="resize-none"
                          rows={2}
                          {...field}
                          value={field.value || ''}
                          data-testid="input-agente-descricao"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="instrucoes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agents.form.instructions')}</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t('agents.placeholders.instructions')}
                          className="resize-none"
                          rows={4}
                          {...field}
                          value={field.value || ''}
                          data-testid="input-agente-instrucoes"
                        />
                      </FormControl>
                      <FormDescription>
                        {t('agents.form.instructionsDesc')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="personalidade"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agents.form.personality')}</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t('agents.placeholders.personality')}
                          className="resize-none"
                          rows={2}
                          {...field}
                          value={field.value || ''}
                          data-testid="input-agente-personalidade"
                        />
                      </FormControl>
                      <FormDescription>
                        {t('agents.form.personalityDesc')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsDialogOpen(false)}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={createAgentMutation.isPending || updateAgentMutation.isPending}
                    data-testid="button-salvar-agente"
                  >
                    {t('common.save')}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <AgentCardSkeleton key={i} />
          ))}
        </div>
      ) : agents && agents.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => {
            const statusInfo = getStatusInfo(agent.status || 'active');
            const StatusIcon = statusInfo.icon;

            return (
              <Card
                key={agent.id}
                className={`hover-elevate transition-all duration-200 ${
                  agent.status !== 'active' ? "opacity-60" : ""
                }`}
                data-testid={`card-agente-${agent.id}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-lg bg-muted ${statusInfo.color}`}
                    >
                      <StatusIcon className="h-6 w-6" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={agent.status === 'active' ? "default" : "secondary"}>
                        {statusInfo.label}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-menu-agente-${agent.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(agent)}>
                            <Edit className="mr-2 h-4 w-4" />
                            {t('common.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              toggleAgentMutation.mutate({
                                id: agent.id,
                                status: agent.status === 'active' ? 'paused' : 'active',
                              })
                            }
                          >
                            <Power className="mr-2 h-4 w-4" />
                            {agent.status === 'active' ? t('agents.actions.pause') : t('agents.actions.activate')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => deleteAgentMutation.mutate(agent.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('common.remove')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <h3 className="font-semibold text-foreground mb-1">{agent.nome}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {agent.descricao || (agent.instrucoes ? agent.instrucoes.substring(0, 100) : t('agents.noDescription'))}
                  </p>
                  <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      <span>{t('agents.conversations', { count: 0 })}</span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {statusInfo.label}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
              <Bot className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-semibold text-foreground mb-2">{t('agents.noAgents')}</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
              {t('agents.noAgentsDesc')}
            </p>
            <Button onClick={handleNewAgent} data-testid="button-criar-primeiro-agente">
              <Plus className="mr-2 h-4 w-4" />
              {t('agents.create')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
