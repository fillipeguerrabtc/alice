/**
 * Página de Gestão de Agentes IA - Enterprise Edition
 * 
 * Permite configurar identidade, personalidade, system prompt e parâmetros do modelo
 * para cada agente de IA da plataforma Alice.
 * 
 * @author Fillipe Guerra
 * @version 4.66
 * @date 15/01/2026
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest, ApiError } from "@/lib/queryClient";
import { useForm, ControllerRenderProps, FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { asResolver } from "@/lib/form-helpers";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Bot,
  Plus,
  MoreHorizontal,
  Trash2,
  Edit,
  Power,
  MessageSquare,
  Briefcase,
  Settings2,
  Brain,
  Sparkles,
  Info,
  Copy,
  User,
  Zap,
  Thermometer,
  Hash,
  FileText,
  Wand2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { formatNumber } from "@/lib/utils";

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

interface Agent {
  id: string;
  tenantId: string | null;
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
  criadoEm: string | null;
  atualizadoEm: string | null;
}

interface AgentModelOption {
  value: string;
  label: string;
  description: string;
}

interface AgentModelOptionsResponse {
  models: AgentModelOption[];
  defaults: {
    modeloBase: string;
    temperaturaModelo: number;
    maxTokens: number;
  };
  constraints: {
    maxTokensMin: number;
    maxTokensMax: number;
  };
}

// Presets de temperatura
const TEMPERATURE_PRESETS = [
  { value: 0, label: 'Determinístico', description: 'Respostas consistentes e previsíveis' },
  { value: 0.3, label: 'Conservador', description: 'Pouca variação, mais preciso' },
  { value: 0.7, label: 'Balanceado', description: 'Equilíbrio entre criatividade e precisão' },
  { value: 1.0, label: 'Criativo', description: 'Respostas mais variadas' },
  { value: 1.5, label: 'Muito Criativo', description: 'Alta variação, experimental' },
] as const;

// Capacidades pré-definidas
const PREDEFINED_CAPABILITIES = [
  'chat',
  'rag',
  'trading',
  'customer-support',
  'sales',
  'technical-support',
  'onboarding',
  'analytics',
  'scheduling',
  'multilingual',
] as const;

// ============================================================================
// TIPOS DE NAMESPACE
// ============================================================================

interface Namespace {
  id: string;
  nome: string;
  slug: string;
  cor: string | null;
}

// ============================================================================
// SCHEMAS DE VALIDAÇÃO
// ============================================================================

const statusOptions = ['active', 'training', 'paused', 'deprecated'] as const;

/**
 * Interface explícita para dados do formulário de agentes
 * Todos os campos configuráveis do agente estão incluídos
 * 
 * NOTA: O schema do banco de dados (packages/shared/src/schema.ts) define
 * apenas temperatura, maxTokens e modeloBase como parâmetros LLM.
 * Para adicionar parâmetros avançados (top_p, frequency_penalty, etc.),
 * seria necessário criar uma migration nova.
 */
interface AgentFormData {
  nome: string;
  slug: string;
  status: typeof statusOptions[number];
  descricao?: string | null;
  avatar?: string | null;
  instrucoes?: string | null;
  personalidade?: string | null;
  modeloBase?: string;
  temperaturaModelo?: number;
  maxTokens?: number;
  capacidades: string[];
  namespaceId?: string | null;
}

/**
 * Schema Zod completo para validação do formulário
 */
function buildAgentFormSchema(opts: {
  maxTokensMin: number;
  maxTokensMax: number;
}): z.ZodType<AgentFormData> {
  return z.object({
    nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(255),
    slug: z
      .string()
      .min(2, 'Slug deve ter pelo menos 2 caracteres')
      .max(100)
      .regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens'),
    status: z.enum(statusOptions),
    descricao: z.string().max(2000).optional().nullable(),
    avatar: z.string().url('URL inválida').optional().nullable().or(z.literal('')),
    instrucoes: z.string().max(10000).optional().nullable(),
    personalidade: z.string().max(5000).optional().nullable(),
    // SSOT: opções/limites vêm do backend (GET /api/agents/model-options)
    modeloBase: z.string().optional(),
    temperaturaModelo: z.number().min(0).max(2).optional(),
    // Gate 2: precisa refletir o limite do backend (min/max) para evitar 400 ao editar agentes legados
    maxTokens: z.number().int().min(opts.maxTokensMin).max(opts.maxTokensMax).optional(),
    capacidades: z.array(z.string()),
    namespaceId: z.string().uuid().optional().nullable(),
  });
}

// ============================================================================
// COMPONENTES AUXILIARES
// ============================================================================

const statusOptionsConfig = [
  { value: "active", icon: Power, color: "text-green-500", bgColor: "bg-green-500/10" },
  { value: "training", icon: Brain, color: "text-blue-500", bgColor: "bg-blue-500/10" },
  { value: "paused", icon: MessageSquare, color: "text-orange-500", bgColor: "bg-orange-500/10" },
  { value: "deprecated", icon: Briefcase, color: "text-muted-foreground", bgColor: "bg-muted" },
];

function AgentCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <Skeleton className="h-14 w-14 rounded-xl" />
          <Skeleton className="h-6 w-20" />
        </div>
        <Skeleton className="h-6 w-40 mb-2" />
        <Skeleton className="h-4 w-full mb-1" />
        <Skeleton className="h-4 w-3/4" />
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}

function CapabilityBadge({ capability, onRemove }: { capability: string; onRemove?: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1">
      {capability}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export default function Agents() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const locale = user?.idioma ?? 'pt-BR';
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);
  const [newCapability, setNewCapability] = useState('');
  const [activeTab, setActiveTab] = useState('basic');

  const statusLabels = statusOptionsConfig.map(opt => ({
    ...opt,
    label: t(`agents.status.${opt.value}`)
  }));

  // SSOT: opções e limites de modelos vêm do chat-service
  // (precisa estar declarado ANTES do uso para evitar TDZ em build/CI)
  const { data: modelOptions } = useQuery<AgentModelOptionsResponse>({
    queryKey: ["/api/agents/model-options"],
    enabled: !!user,
  });

  // Formulário com valores padrão enterprise
  // SSOT: limites vêm do backend, mas mantemos fallback seguro coerente com Gate 2
  // para evitar divergência em render inicial antes do model-options carregar.
  const maxTokensMin = modelOptions?.constraints?.maxTokensMin ?? 100;
  const maxTokensMax = modelOptions?.constraints?.maxTokensMax ?? 2048;
  const agentFormSchema = useMemo(
    () => buildAgentFormSchema({ maxTokensMin, maxTokensMax }),
    [maxTokensMin, maxTokensMax],
  );

  const form = useForm<AgentFormData>({
    resolver: asResolver<AgentFormData>(zodResolver(agentFormSchema)),
    defaultValues: {
      nome: "",
      slug: "",
      status: "active",
      descricao: "",
      avatar: "",
      instrucoes: "",
      personalidade: "",
      modeloBase: undefined,
      temperaturaModelo: undefined,
      maxTokens: undefined,
      capacidades: [],
      namespaceId: null,
    },
  });

  // Query para listar agentes
  const { data: agents, isLoading } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    enabled: !!user,
  });

  // Query para listar namespaces (para associar agentes)
  const { data: namespaces } = useQuery<Namespace[]>({
    queryKey: ["/api/namespaces"],
    enabled: !!user,
  });

  // Mutations
  const createAgentMutation = useMutation({
    mutationFn: async (data: AgentFormData) => {
      const payload = {
        ...data,
        avatar: data.avatar || null,
        descricao: data.descricao || null,
        instrucoes: data.instrucoes || null,
        personalidade: data.personalidade || null,
      };
      if (!payload.modeloBase || payload.modeloBase.trim().length === 0) delete (payload as { modeloBase?: string }).modeloBase;
      if (!payload.temperaturaModelo && payload.temperaturaModelo !== 0) delete (payload as { temperaturaModelo?: number }).temperaturaModelo;
      if (!payload.maxTokens) delete (payload as { maxTokens?: number }).maxTokens;
      const res = await apiRequest("POST", "/api/agents", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({ title: t('agents.success.created') });
      handleCloseSheet();
    },
    onError: (error: Error) => {
      const description =
        error instanceof ApiError && error.body
          ? JSON.stringify(error.body)
          : error.message;
      toast({
        title: t('agents.errors.create'),
        description,
        variant: "destructive"
      });
    },
  });

  const updateAgentMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<AgentFormData> }) => {
      const payload = {
        ...data,
        avatar: data.avatar || null,
        descricao: data.descricao || null,
        instrucoes: data.instrucoes || null,
        personalidade: data.personalidade || null,
      };
      if (!payload.modeloBase || payload.modeloBase.trim().length === 0) delete (payload as { modeloBase?: string }).modeloBase;
      if (!payload.temperaturaModelo && payload.temperaturaModelo !== 0) delete (payload as { temperaturaModelo?: number }).temperaturaModelo;
      if (!payload.maxTokens) delete (payload as { maxTokens?: number }).maxTokens;
      const res = await apiRequest("PATCH", `/api/agents/${id}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({ title: t('agents.success.updated') });
      handleCloseSheet();
    },
    onError: (error: Error) => {
      const description =
        error instanceof ApiError && error.body
          ? JSON.stringify(error.body)
          : error.message;
      toast({
        title: t('agents.errors.update'),
        description,
        variant: "destructive"
      });
    },
  });

  const deleteAgentMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/agents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({ title: t('agents.success.removed') });
      setDeleteDialogOpen(false);
      setAgentToDelete(null);
    },
    onError: (error: Error) => {
      const description =
        error instanceof ApiError && error.body
          ? JSON.stringify(error.body)
          : error.message;
      toast({
        title: t('agents.errors.remove'),
        description,
        variant: "destructive"
      });
    },
  });

  const toggleAgentMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'paused' }) => {
      const res = await apiRequest("PATCH", `/api/agents/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({ title: t('agents.success.updated') });
    },
  });

  // Handlers
  const handleCloseSheet = () => {
    setIsSheetOpen(false);
    setEditingAgent(null);
    setActiveTab('basic');
    form.reset({
      nome: "",
      slug: "",
      status: "active",
      descricao: "",
      avatar: "",
      instrucoes: "",
      personalidade: "",
      modeloBase: modelOptions?.defaults?.modeloBase,
      temperaturaModelo: modelOptions?.defaults?.temperaturaModelo,
      maxTokens: modelOptions?.defaults?.maxTokens,
      capacidades: [],
      namespaceId: null,
    });
  };

  const handleSubmit = (data: AgentFormData) => {
    if (editingAgent) {
      updateAgentMutation.mutate({ id: editingAgent.id, data });
    } else {
      createAgentMutation.mutate(data);
    }
  };

  const handleSubmitError = (errors: FieldErrors<AgentFormData>) => {
    const firstField = Object.keys(errors)[0] as keyof AgentFormData | undefined;
    if (firstField) {
      const fieldTabMap: Partial<Record<keyof AgentFormData, string>> = {
        nome: 'basic',
        slug: 'basic',
        status: 'basic',
        descricao: 'basic',
        avatar: 'basic',
        namespaceId: 'basic',
        instrucoes: 'prompt',
        personalidade: 'prompt',
        modeloBase: 'model',
        temperaturaModelo: 'model',
        maxTokens: 'model',
        capacidades: 'capabilities',
      };
      setActiveTab(fieldTabMap[firstField] ?? 'basic');
    }
    toast({ title: t('errors.validationError'), variant: "destructive" });
  };

  const handleEdit = (agent: Agent) => {
    setEditingAgent(agent);
    const requestedMaxTokens = agent.maxTokens ?? modelOptions?.defaults?.maxTokens;
    const effectiveMaxTokens =
      typeof requestedMaxTokens === 'number' && requestedMaxTokens > maxTokensMax
        ? maxTokensMax
        : requestedMaxTokens;
    if (typeof requestedMaxTokens === 'number' && requestedMaxTokens > maxTokensMax) {
      toast({
        title: 'maxTokens ajustado automaticamente (Gate 2)',
        description: `Valor legado (${requestedMaxTokens}) excede o limite atual (${maxTokensMax}). Ajustado para ${maxTokensMax} para permitir a atualização do agente.`,
      });
    }
    form.reset({
      nome: agent.nome,
      slug: agent.slug,
      descricao: agent.descricao || "",
      avatar: agent.avatar || "",
      instrucoes: agent.instrucoes || "",
      personalidade: agent.personalidade || "",
      status: agent.status || "active",
      modeloBase: agent.modeloBase || modelOptions?.defaults?.modeloBase,
      temperaturaModelo: agent.temperaturaModelo ?? modelOptions?.defaults?.temperaturaModelo,
      maxTokens: effectiveMaxTokens,
      capacidades: agent.capacidades || [],
      namespaceId: agent.namespaceId || null,
    });
    setActiveTab('basic');
    setIsSheetOpen(true);
  };

  const handleNewAgent = () => {
    setEditingAgent(null);
    form.reset();
    setActiveTab('basic');
    setIsSheetOpen(true);
  };

  const handleCopySlug = (slug: string) => {
    navigator.clipboard.writeText(slug);
    toast({ title: t('success.copied') });
  };

  const handleAddCapability = () => {
    if (newCapability.trim()) {
      const current = form.getValues('capacidades');
      if (!current.includes(newCapability.trim())) {
        form.setValue('capacidades', [...current, newCapability.trim()]);
      }
      setNewCapability('');
    }
  };

  const handleRemoveCapability = (cap: string) => {
    const current = form.getValues('capacidades');
    form.setValue('capacidades', current.filter(c => c !== cap));
  };

  const getStatusInfo = (status: string) => {
    return statusLabels.find((s) => s.value === status) || statusLabels[0];
  };

  const getTemperatureLabel = (temp: number) => {
    const preset = TEMPERATURE_PRESETS.find(p => Math.abs(p.value - temp) < 0.05);
    return preset?.label || `${temp.toFixed(1)}`;
  };

  const activeAgents = agents?.filter((a) => a.status === 'active').length || 0;
  const totalAgents = agents?.length || 0;

  // TypeScript strict: watch() pode retornar undefined antes de defaultValues hydratar.
  const watchedTemperature = form.watch('temperaturaModelo') ?? modelOptions?.defaults?.temperaturaModelo ?? 0.7;
  const watchedCapacidades = form.watch('capacidades');

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3" data-testid="text-page-title">
            <Bot className="h-8 w-8 text-primary" />
            {t('agents.title')}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t('agents.subtitle', { active: activeAgents, total: totalAgents })}
          </p>
        </div>
        <Button onClick={handleNewAgent} size="lg" data-testid="button-criar-agente">
          <Plus className="mr-2 h-5 w-5" />
          {t('agents.create')}
        </Button>
      </div>

      {/* Grid de Agentes */}
      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <AgentCardSkeleton key={i} />
          ))}
        </div>
      ) : agents && agents.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => {
            const statusInfo = getStatusInfo(agent.status || 'active');
            const StatusIcon = statusInfo.icon;

            return (
              <Card
                key={agent.id}
                className={`overflow-hidden hover:shadow-lg transition-all duration-200 cursor-pointer group ${
                  agent.status !== 'active' ? "opacity-70" : ""
                }`}
                onClick={() => handleEdit(agent)}
                data-testid={`card-agente-${agent.id}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div
                      className={`flex h-14 w-14 items-center justify-center rounded-xl ${statusInfo.bgColor} ${statusInfo.color} transition-transform group-hover:scale-105`}
                    >
                      {agent.avatar ? (
                        <img 
                          src={agent.avatar} 
                          alt={agent.nome} 
                          className="h-10 w-10 rounded-lg object-cover"
                        />
                      ) : (
                        <Bot className="h-7 w-7" />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant={agent.status === 'active' ? "default" : "secondary"}
                        className={agent.status === 'active' ? "bg-green-500/10 text-green-600 border-green-500/20" : ""}
                      >
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {statusInfo.label}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-menu-agente-${agent.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem onClick={() => handleEdit(agent)}>
                            <Edit className="mr-2 h-4 w-4" />
                            {t('common.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleCopySlug(agent.slug)}>
                            <Copy className="mr-2 h-4 w-4" />
                            {t('agents.actions.copySlug')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
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
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              setAgentToDelete(agent);
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('common.remove')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  
                  <h3 className="font-semibold text-lg text-foreground mb-1">{agent.nome}</h3>
                  <p className="text-xs text-muted-foreground font-mono mb-2">@{agent.slug}</p>
                  <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
                    {agent.descricao || agent.instrucoes?.substring(0, 100) || t('agents.noDescription')}
                  </p>
                  
                  {/* Info Cards */}
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="bg-muted/50 rounded-lg p-2 text-center">
                      <Thermometer className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                      <span className="text-xs font-medium">
                        {formatNumber(agent.temperaturaModelo ?? 0.7, locale, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}
                      </span>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2 text-center">
                      <Hash className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                      <span className="text-xs font-medium">
                        {formatNumber(
                          agent.maxTokens ?? modelOptions?.defaults?.maxTokens ?? 0,
                          locale
                        ) || '—'}
                      </span>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2 text-center">
                      <Zap className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                      <span className="text-xs font-medium">
                        {formatNumber(agent.capacidades?.length ?? 0, locale)}
                      </span>
                    </div>
                  </div>

                  {/* Capacidades */}
                  {agent.capacidades && agent.capacidades.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {agent.capacidades.slice(0, 3).map((cap) => (
                        <Badge key={cap} variant="outline" className="text-xs">
                          {cap}
                        </Badge>
                      ))}
                      {agent.capacidades.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{agent.capacidades.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mb-6">
              <Bot className="h-10 w-10 text-primary" />
            </div>
            <h3 className="font-semibold text-xl text-foreground mb-2">{t('agents.noAgents')}</h3>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              {t('agents.noAgentsDesc')}
            </p>
            <Button onClick={handleNewAgent} size="lg" data-testid="button-criar-primeiro-agente">
              <Plus className="mr-2 h-5 w-5" />
              {t('agents.create')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Sheet de Edição/Criação */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className="sm:max-w-[640px] overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle className="flex items-center gap-2 text-xl">
              {editingAgent ? <Edit className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              {editingAgent ? t('agents.form.dialogTitleEdit') : t('agents.form.dialogTitle')}
            </SheetTitle>
            <SheetDescription>
              {t('agents.form.dialogDescFull')}
            </SheetDescription>
          </SheetHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit, handleSubmitError)} className="space-y-6">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-4 mb-4">
                  <TabsTrigger value="basic" className="text-xs sm:text-sm">
                    <User className="h-4 w-4 mr-1 hidden sm:inline" />
                    {t('agents.tabs.basic')}
                  </TabsTrigger>
                  <TabsTrigger value="prompt" className="text-xs sm:text-sm">
                    <FileText className="h-4 w-4 mr-1 hidden sm:inline" />
                    {t('agents.tabs.prompt')}
                  </TabsTrigger>
                  <TabsTrigger value="model" className="text-xs sm:text-sm">
                    <Settings2 className="h-4 w-4 mr-1 hidden sm:inline" />
                    {t('agents.tabs.model')}
                  </TabsTrigger>
                  <TabsTrigger value="capabilities" className="text-xs sm:text-sm">
                    <Sparkles className="h-4 w-4 mr-1 hidden sm:inline" />
                    {t('agents.tabs.capabilities')}
                  </TabsTrigger>
                </TabsList>

                {/* Tab: Informações Básicas */}
                <TabsContent value="basic" className="space-y-4 mt-0">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <User className="h-4 w-4" />
                        {t('agents.sections.identity')}
                      </CardTitle>
                      <CardDescription>{t('agents.sections.identityDesc')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <FormField
                        control={form.control}
                        name="nome"
                        render={({ field }: { field: ControllerRenderProps<AgentFormData, 'nome'> }) => (
                          <FormItem>
                            <FormLabel>{t('agents.form.name')} *</FormLabel>
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
                        render={({ field }: { field: ControllerRenderProps<AgentFormData, 'slug'> }) => (
                          <FormItem>
                            <FormLabel>{t('agents.form.slug')} *</FormLabel>
                            <FormControl>
                              <div className="flex">
                                <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-input bg-muted text-sm text-muted-foreground">
                                  @
                                </span>
                                <Input
                                  className="rounded-l-none"
                                  placeholder={t('agents.placeholders.slug')}
                                  {...field}
                                  data-testid="input-agente-slug"
                                />
                              </div>
                            </FormControl>
                            <FormDescription>{t('agents.form.slugDesc')}</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="avatar"
                        render={({ field }: { field: ControllerRenderProps<AgentFormData, 'avatar'> }) => (
                          <FormItem>
                            <FormLabel>{t('agents.form.avatar')}</FormLabel>
                            <FormControl>
                              <Input
                                type="url"
                                placeholder={t('agents.placeholders.avatar')}
                                {...field}
                                value={field.value || ''}
                                data-testid="input-agente-avatar"
                              />
                            </FormControl>
                            <FormDescription>{t('agents.form.avatarDesc')}</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="status"
                        render={({ field }: { field: ControllerRenderProps<AgentFormData, 'status'> }) => (
                          <FormItem>
                            <FormLabel>{t('agents.status.label')}</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-agente-status">
                                  <SelectValue placeholder={t('agents.status.selectPlaceholder')} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {statusLabels.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    <div className="flex items-center gap-2">
                                      <option.icon className={`h-4 w-4 ${option.color}`} />
                                      {option.label}
                                    </div>
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
                        name="namespaceId"
                        render={({ field }: { field: ControllerRenderProps<AgentFormData, 'namespaceId'> }) => (
                          <FormItem>
                            <FormLabel>{t('agents.form.namespace')}</FormLabel>
                            <Select 
                              onValueChange={(value) => field.onChange(value === 'none' ? null : value)} 
                              value={field.value || 'none'}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-agente-namespace">
                                  <SelectValue placeholder={t('agents.placeholders.namespace')} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="none">
                                  {t('agents.form.noNamespace')}
                                </SelectItem>
                                {namespaces?.map((ns) => (
                                  <SelectItem key={ns.id} value={ns.id}>
                                    <div className="flex items-center gap-2">
                                      {ns.cor && (
                                        <div 
                                          className="w-3 h-3 rounded-full" 
                                          style={{ backgroundColor: ns.cor }}
                                        />
                                      )}
                                      {ns.nome}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormDescription>{t('agents.form.namespaceDesc')}</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="descricao"
                        render={({ field }: { field: ControllerRenderProps<AgentFormData, 'descricao'> }) => (
                          <FormItem>
                            <FormLabel>{t('agents.form.description')}</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder={t('agents.placeholders.description')}
                                className="resize-none"
                                rows={3}
                                {...field}
                                value={field.value || ''}
                                data-testid="input-agente-descricao"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Tab: System Prompt & Personalidade */}
                <TabsContent value="prompt" className="space-y-4 mt-0">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Wand2 className="h-4 w-4" />
                        {t('agents.sections.behavior')}
                      </CardTitle>
                      <CardDescription>{t('agents.sections.behaviorDesc')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <FormField
                        control={form.control}
                        name="instrucoes"
                        render={({ field }: { field: ControllerRenderProps<AgentFormData, 'instrucoes'> }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">
                              <FileText className="h-4 w-4" />
                              {t('agents.form.systemPrompt')}
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder={t('agents.placeholders.systemPrompt')}
                                className="resize-none font-mono text-sm"
                                rows={10}
                                {...field}
                                value={field.value || ''}
                                data-testid="input-agente-instrucoes"
                              />
                            </FormControl>
                            <FormDescription>
                              {t('agents.form.systemPromptDesc')}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <Separator />

                      <FormField
                        control={form.control}
                        name="personalidade"
                        render={({ field }: { field: ControllerRenderProps<AgentFormData, 'personalidade'> }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">
                              <Brain className="h-4 w-4" />
                              {t('agents.form.personality')}
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder={t('agents.placeholders.personality')}
                                className="resize-none"
                                rows={4}
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

                      <div className="bg-muted/50 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                          <Info className="h-5 w-5 text-muted-foreground mt-0.5" />
                          <div className="text-sm text-muted-foreground">
                            <p className="font-medium mb-1">{t('agents.tips.promptTitle')}</p>
                            <ul className="list-disc list-inside space-y-1 text-xs">
                              <li>{t('agents.tips.promptTip1')}</li>
                              <li>{t('agents.tips.promptTip2')}</li>
                              <li>{t('agents.tips.promptTip3')}</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Tab: Configurações do Modelo */}
                <TabsContent value="model" className="space-y-4 mt-0">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Settings2 className="h-4 w-4" />
                        {t('agents.sections.modelConfig')}
                      </CardTitle>
                      <CardDescription>{t('agents.sections.modelConfigDesc')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <FormField
                        control={form.control}
                        name="modeloBase"
                        render={({ field }: { field: ControllerRenderProps<AgentFormData, 'modeloBase'> }) => (
                          <FormItem>
                            <FormLabel>{t('agents.form.baseModel')}</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value ?? ''}>
                              <FormControl>
                                <SelectTrigger data-testid="select-agente-modelo">
                                  <SelectValue placeholder={t('agents.placeholders.selectModel')} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {(modelOptions?.models || []).map((model) => (
                                  <SelectItem key={model.value} value={model.value}>
                                    <div className="flex flex-col">
                                      <span className="font-medium">{model.label}</span>
                                      {model.description && (
                                        <span className="text-xs text-muted-foreground">{model.description}</span>
                                      )}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormDescription>{t('agents.form.baseModelDesc')}</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <Separator />

                      <FormField
                        control={form.control}
                        name="temperaturaModelo"
                        render={({ field }: { field: ControllerRenderProps<AgentFormData, 'temperaturaModelo'> }) => {
                          // CORREÇÃO 02/01/2026: Garantir valor padrão para evitar undefined (TS18048/TS2345)
                          const temperatureValue =
                            field.value ?? modelOptions?.defaults?.temperaturaModelo ?? 0.7;
                          return (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel className="flex items-center gap-2">
                                <Thermometer className="h-4 w-4" />
                                {t('agents.form.temperature')}
                              </FormLabel>
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="font-mono">
                                  {temperatureValue.toFixed(2)}
                                </Badge>
                                <span className="text-sm text-muted-foreground">
                                  ({getTemperatureLabel(temperatureValue)})
                                </span>
                              </div>
                            </div>
                            <FormControl>
                              <Slider
                                min={0}
                                max={2}
                                step={0.05}
                                value={[temperatureValue]}
                                onValueChange={(vals: number[]) => field.onChange(vals[0])}
                                className="mt-2"
                                data-testid="slider-agente-temperatura"
                              />
                            </FormControl>
                            <div className="flex justify-between text-xs text-muted-foreground mt-1">
                              <span>{t('agents.temperatureLabels.deterministic')}</span>
                              <span>{t('agents.temperatureLabels.balanced')}</span>
                              <span>{t('agents.temperatureLabels.creative')}</span>
                            </div>
                            <FormDescription className="mt-2">
                              {t('agents.form.temperatureDesc')}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                          );
                        }}
                      />

                      {/* Presets de Temperatura */}
                      <div className="grid grid-cols-5 gap-2">
                        {TEMPERATURE_PRESETS.map((preset) => (
                          <Button
                            key={preset.value}
                            type="button"
                            variant={Math.abs(watchedTemperature - preset.value) < 0.05 ? "default" : "outline"}
                            size="sm"
                            className="text-xs"
                            onClick={() => form.setValue('temperaturaModelo', preset.value)}
                          >
                            {preset.value}
                          </Button>
                        ))}
                      </div>

                      <Separator />

                      <FormField
                        control={form.control}
                        name="maxTokens"
                        render={({ field }: { field: ControllerRenderProps<AgentFormData, 'maxTokens'> }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">
                              <Hash className="h-4 w-4" />
                              {t('agents.form.maxTokens')}
                            </FormLabel>
                            <FormControl>
                              <div className="flex gap-2">
                                <Input
                                  type="number"
                                  min={modelOptions?.constraints?.maxTokensMin ?? 1}
                                  max={modelOptions?.constraints?.maxTokensMax}
                                  {...field}
                                  value={field.value ?? ''}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    const parsed = raw.trim().length === 0 ? undefined : Number.parseInt(raw, 10);
                                    field.onChange(Number.isFinite(parsed) ? parsed : undefined);
                                  }}
                                  className="font-mono"
                                  data-testid="input-agente-maxtokens"
                                />
                                <Select
                                  value={field.value ? String(field.value) : ''}
                                  onValueChange={(v) => {
                                    const parsed = Number.parseInt(v, 10);
                                    field.onChange(Number.isFinite(parsed) ? parsed : undefined);
                                  }}
                                >
                                  <SelectTrigger className="w-32">
                                    <SelectValue placeholder="-" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(() => {
                                      const min = modelOptions?.constraints?.maxTokensMin ?? 1;
                                      const max = modelOptions?.constraints?.maxTokensMax ?? 0;
                                      if (!max) return [];
                                      const candidates = [
                                        Math.floor(max / 4),
                                        Math.floor(max / 2),
                                        max,
                                      ].filter((v) => v >= min && v > 0);
                                      const unique = Array.from(new Set(candidates)).sort((a, b) => a - b);
                                      return unique.map((val) => (
                                        <SelectItem key={val} value={String(val)}>
                                          {formatNumber(val, locale)}
                                        </SelectItem>
                                      ));
                                    })()}
                                  </SelectContent>
                                </Select>
                              </div>
                            </FormControl>
                            <FormDescription>
                              {t('agents.form.maxTokensDesc')}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Tab: Capacidades */}
                <TabsContent value="capabilities" className="space-y-4 mt-0">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        {t('agents.sections.capabilities')}
                      </CardTitle>
                      <CardDescription>{t('agents.sections.capabilitiesDesc')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Capacidades adicionadas */}
                      <div>
                        <Label className="text-sm mb-2 block">{t('agents.form.activeCapabilities')}</Label>
                        <div className="flex flex-wrap gap-2 min-h-[60px] p-3 border rounded-lg bg-muted/30">
                          {watchedCapacidades.length > 0 ? (
                            watchedCapacidades.map((cap) => (
                              <CapabilityBadge
                                key={cap}
                                capability={cap}
                                onRemove={() => handleRemoveCapability(cap)}
                              />
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {t('agents.form.noCapabilities')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Adicionar capacidade customizada */}
                      <div>
                        <Label className="text-sm mb-2 block">{t('agents.form.addCapability')}</Label>
                        <div className="flex gap-2">
                          <Input
                            value={newCapability}
                            onChange={(e) => setNewCapability(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                            placeholder={t('agents.placeholders.capability')}
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCapability())}
                          />
                          <Button type="button" variant="outline" onClick={handleAddCapability}>
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <Separator />

                      {/* Capacidades pré-definidas */}
                      <div>
                        <Label className="text-sm mb-2 block">{t('agents.form.suggestedCapabilities')}</Label>
                        <div className="flex flex-wrap gap-2">
                          {PREDEFINED_CAPABILITIES.map((cap) => (
                            <Button
                              key={cap}
                              type="button"
                              variant={watchedCapacidades.includes(cap) ? "default" : "outline"}
                              size="sm"
                              onClick={() => {
                                if (watchedCapacidades.includes(cap)) {
                                  handleRemoveCapability(cap);
                                } else {
                                  form.setValue('capacidades', [...watchedCapacidades, cap]);
                                }
                              }}
                            >
                              {cap}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              {/* Botões de Ação */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCloseSheet}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={createAgentMutation.isPending || updateAgentMutation.isPending}
                  data-testid="button-salvar-agente"
                >
                  {(createAgentMutation.isPending || updateAgentMutation.isPending) ? (
                    <>
                      <span className="animate-spin mr-2">⏳</span>
                      {t('common.loading')}
                    </>
                  ) : (
                    t('common.save')
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </SheetContent>
      </Sheet>

      {/* Dialog de Confirmação de Exclusão */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirm.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('agents.confirmDelete', { name: agentToDelete?.nome })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => agentToDelete && deleteAgentMutation.mutate(agentToDelete.id)}
            >
              {t('common.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
