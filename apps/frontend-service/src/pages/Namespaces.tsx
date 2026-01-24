import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm, ControllerRenderProps } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { asResolver } from "@/lib/form-helpers";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Folder,
  Plus,
  MoreHorizontal,
  Settings,
  Trash2,
  Edit,
  Users,
  Bot,
  FileText,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface Namespace {
  id: string;
  nome: string;
  slug: string;
  descricao?: string | null;
  cor?: string | null;
  icone?: string | null;
  contextoSistema?: string | null;
  ordem?: number | null;
  ativo?: boolean | null;
}

const defaultColors = [
  "#3B82F6",
  "#10B981",
  "#8B5CF6",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#06B6D4",
  "#84CC16",
];

/**
 * Interface explícita para dados do formulário de namespaces
 * Definida primeiro para evitar TS2589 (melhores práticas 2025)
 */
interface NamespaceFormData {
  nome: string;
  slug: string;
  cor: string;
  descricao?: string;
}

/**
 * Schema Zod com tipo explícito para evitar inferência recursiva
 */
const namespaceSchema: z.ZodType<NamespaceFormData> = z.object({
  nome: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  cor: z.string(),
  descricao: z.string().optional(),
});

const namespaceSettingsSchema = z.object({
  icone: z.string().max(50).optional(),
  contextoSistema: z.string().max(20000).optional(),
  ordem: z.preprocess((value) => {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }, z.number().int().min(0).max(9999).nullable().optional()),
  ativo: z.boolean(),
});

type NamespaceSettingsFormData = z.infer<typeof namespaceSettingsSchema>;

function NamespaceCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <Skeleton className="h-8 w-8" />
        </div>
        <Skeleton className="h-5 w-32 mb-2" />
        <Skeleton className="h-4 w-full" />
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function Namespaces() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingNamespace, setEditingNamespace] = useState<Namespace | null>(null);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [settingsNamespace, setSettingsNamespace] = useState<Namespace | null>(null);

  const form = useForm<NamespaceFormData>({
    resolver: asResolver<NamespaceFormData>(zodResolver(namespaceSchema)),
    defaultValues: {
      nome: "",
      slug: "",
      cor: "#3B82F6",
      descricao: "",
    },
  });

  const settingsForm = useForm<NamespaceSettingsFormData>({
    resolver: asResolver<NamespaceSettingsFormData>(zodResolver(namespaceSettingsSchema)),
    defaultValues: {
      icone: "",
      contextoSistema: "",
      ordem: null,
      ativo: true,
    },
  });

  const { data: namespaces, isLoading } = useQuery<Namespace[]>({
    queryKey: ["/api/namespaces"],
    enabled: !!user,
  });

  const createNamespaceMutation = useMutation({
    mutationFn: async (data: NamespaceFormData) => {
      const res = await apiRequest("POST", "/api/namespaces", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/namespaces"] });
      toast({ title: t('namespaces.success.created') });
      setIsDialogOpen(false);
      form.reset();
    },
    onError: () => {
      toast({ title: t('namespaces.errors.create'), variant: "destructive" });
    },
  });

  const updateNamespaceMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<NamespaceFormData & NamespaceSettingsFormData> }) => {
      const res = await apiRequest("PATCH", `/api/namespaces/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/namespaces"] });
      toast({ title: t('namespaces.success.updated') });
      setIsDialogOpen(false);
      setEditingNamespace(null);
      form.reset();
    },
    onError: () => {
      toast({ title: t('namespaces.errors.update'), variant: "destructive" });
    },
  });

  const deleteNamespaceMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/namespaces/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/namespaces"] });
      toast({ title: t('namespaces.success.removed') });
    },
    onError: () => {
      toast({ title: t('namespaces.errors.remove'), variant: "destructive" });
    },
  });

  const handleSubmit = (data: NamespaceFormData) => {
    if (editingNamespace) {
      updateNamespaceMutation.mutate({ id: editingNamespace.id, data });
    } else {
      createNamespaceMutation.mutate(data);
    }
  };

  const handleEdit = (namespace: Namespace) => {
    setEditingNamespace(namespace);
    form.reset({
      nome: namespace.nome,
      slug: namespace.slug,
      descricao: namespace.descricao || "",
      cor: namespace.cor || "#3B82F6",
    });
    setIsDialogOpen(true);
  };

  const handleSettings = (namespace: Namespace) => {
    setSettingsNamespace(namespace);
    settingsForm.reset({
      icone: namespace.icone ?? "",
      contextoSistema: namespace.contextoSistema ?? "",
      ordem: namespace.ordem ?? null,
      ativo: namespace.ativo ?? true,
    });
    setIsSettingsDialogOpen(true);
  };

  const handleNewNamespace = () => {
    setEditingNamespace(null);
    form.reset();
    setIsDialogOpen(true);
  };

  const handleSettingsSubmit = (data: NamespaceSettingsFormData) => {
    if (!settingsNamespace) return;
    const normalizedData: Partial<NamespaceSettingsFormData> = {
      icone: data.icone?.trim() ? data.icone.trim() : undefined,
      contextoSistema: data.contextoSistema?.trim() ? data.contextoSistema.trim() : undefined,
      ordem: typeof data.ordem === "number" ? data.ordem : null,
      ativo: data.ativo,
    };
    updateNamespaceMutation.mutate({ id: settingsNamespace.id, data: normalizedData });
    setIsSettingsDialogOpen(false);
    setSettingsNamespace(null);
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
            {t('namespaces.title')}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t('namespaces.subtitle', { count: namespaces?.length || 0 })}
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleNewNamespace} data-testid="button-criar-namespace">
              <Plus className="mr-2 h-4 w-4" />
              {t('namespaces.create')}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>
                {editingNamespace ? t('namespaces.edit') : t('namespaces.create')}
              </DialogTitle>
              <DialogDescription>
                {t('namespaces.dialogDesc')}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="nome"
                  render={({ field }: { field: ControllerRenderProps<NamespaceFormData, 'nome'> }) => (
                    <FormItem>
                      <FormLabel>{t('namespaces.name')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('namespaces.placeholders.name')}
                          {...field}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            field.onChange(e);
                            if (!editingNamespace) {
                              form.setValue("slug", generateSlug(e.target.value));
                            }
                          }}
                          data-testid="input-namespace-nome"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }: { field: ControllerRenderProps<NamespaceFormData, 'slug'> }) => (
                    <FormItem>
                      <FormLabel>{t('namespaces.slug')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('namespaces.placeholders.slug')}
                          {...field}
                          data-testid="input-namespace-slug"
                        />
                      </FormControl>
                      <FormDescription>
                        {t('namespaces.slugUrl', { slug: field.value || "slug" })}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="descricao"
                  render={({ field }: { field: ControllerRenderProps<NamespaceFormData, 'descricao'> }) => (
                    <FormItem>
                      <FormLabel>{t('namespaces.description')}</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t('namespaces.placeholders.description')}
                          className="resize-none"
                          rows={2}
                          {...field}
                          data-testid="input-namespace-descricao"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="cor"
                  render={({ field }: { field: ControllerRenderProps<NamespaceFormData, 'cor'> }) => (
                    <FormItem>
                      <FormLabel>{t('namespaces.color')}</FormLabel>
                      <FormControl>
                        <div className="flex flex-wrap gap-2">
                          {defaultColors.map((color) => (
                            <button
                              key={color}
                              type="button"
                              onClick={() => field.onChange(color)}
                              className={`h-8 w-8 rounded-full transition-transform ${
                                field.value === color
                                  ? "ring-2 ring-primary ring-offset-2 scale-110"
                                  : "hover:scale-105"
                              }`}
                              style={{ backgroundColor: color }}
                              data-testid={`color-${color}`}
                            />
                          ))}
                        </div>
                      </FormControl>
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
                    disabled={createNamespaceMutation.isPending || updateNamespaceMutation.isPending}
                    data-testid="button-salvar-namespace"
                  >
                    {t('common.save')}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        <Dialog open={isSettingsDialogOpen} onOpenChange={setIsSettingsDialogOpen}>
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>{t('namespaces.settings.title')}</DialogTitle>
              <DialogDescription>{t('namespaces.settings.description')}</DialogDescription>
            </DialogHeader>
            <Form {...settingsForm}>
              <form onSubmit={settingsForm.handleSubmit(handleSettingsSubmit)} className="space-y-4">
                <FormField
                  control={settingsForm.control}
                  name="icone"
                  render={({ field }: { field: ControllerRenderProps<NamespaceSettingsFormData, 'icone'> }) => (
                    <FormItem>
                      <FormLabel>{t('namespaces.settings.icon')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Ex: Briefcase, ChartLine"
                          {...field}
                          data-testid="input-namespace-icone"
                        />
                      </FormControl>
                      <FormDescription>{t('namespaces.settings.iconHint')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={settingsForm.control}
                  name="contextoSistema"
                  render={({ field }: { field: ControllerRenderProps<NamespaceSettingsFormData, 'contextoSistema'> }) => (
                    <FormItem>
                      <FormLabel>{t('namespaces.settings.systemContext')}</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t('namespaces.settings.systemContextPlaceholder')}
                          className="resize-none min-h-[140px]"
                          rows={6}
                          {...field}
                          data-testid="input-namespace-contexto"
                        />
                      </FormControl>
                      <FormDescription>{t('namespaces.settings.systemContextHint')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={settingsForm.control}
                    name="ordem"
                    render={({ field }: { field: ControllerRenderProps<NamespaceSettingsFormData, 'ordem'> }) => (
                      <FormItem>
                        <FormLabel>{t('namespaces.settings.order')}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            max={9999}
                            value={field.value ?? ''}
                            onChange={(event) => {
                              const value = event.target.value;
                              field.onChange(value === '' ? null : Number(value));
                            }}
                            data-testid="input-namespace-ordem"
                          />
                        </FormControl>
                        <FormDescription>{t('namespaces.settings.orderHint')}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={settingsForm.control}
                    name="ativo"
                    render={({ field }: { field: ControllerRenderProps<NamespaceSettingsFormData, 'ativo'> }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-1">
                          <FormLabel>{t('namespaces.settings.active')}</FormLabel>
                          <FormDescription>{t('namespaces.settings.activeHint')}</FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-namespace-ativo"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsSettingsDialogOpen(false)}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={updateNamespaceMutation.isPending}
                    data-testid="button-salvar-namespace-settings"
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
            <NamespaceCardSkeleton key={i} />
          ))}
        </div>
      ) : namespaces && namespaces.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {namespaces.map((namespace) => (
            <Card
              key={namespace.id}
              className="hover-elevate transition-all duration-200"
              data-testid={`card-namespace-${namespace.id}`}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-lg font-bold text-lg text-white"
                    style={{ backgroundColor: namespace.cor || "#3B82F6" }}
                  >
                    {namespace.nome.charAt(0).toUpperCase()}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" data-testid={`button-menu-namespace-${namespace.id}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit(namespace)}>
                        <Edit className="mr-2 h-4 w-4" />
                        {t('common.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleSettings(namespace)}>
                        <Settings className="mr-2 h-4 w-4" />
                        {t('common.settings')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => deleteNamespaceMutation.mutate(namespace.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('common.remove')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <h3 className="font-semibold text-foreground mb-1">{namespace.nome}</h3>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                  {namespace.descricao || `/${namespace.slug}`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="gap-1 text-xs">
                    <Bot className="h-3 w-3" />
                    {t('namespaces.stats.agents', { count: 0 })}
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-xs">
                    <FileText className="h-3 w-3" />
                    {t('namespaces.stats.docs', { count: 0 })}
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-xs">
                    <Users className="h-3 w-3" />
                    {t('namespaces.stats.users', { count: 0 })}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
              <Folder className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-semibold text-foreground mb-2">{t('namespaces.noNamespaces')}</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
              {t('namespaces.noNamespacesDesc')}
            </p>
            <Button onClick={handleNewNamespace} data-testid="button-criar-primeiro-namespace">
              <Plus className="mr-2 h-4 w-4" />
              {t('namespaces.create')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
