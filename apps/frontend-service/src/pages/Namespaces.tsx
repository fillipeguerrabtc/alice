import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
}

const namespaceSchema = z.object({
  nome: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  slug: z.string().min(2, "Slug deve ter pelo menos 2 caracteres").regex(/^[a-z0-9-]+$/, "Slug deve conter apenas letras minúsculas, números e hífens"),
  descricao: z.string().optional(),
  cor: z.string().default("#3B82F6"),
});

type NamespaceFormData = z.infer<typeof namespaceSchema>;

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
  const { user } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingNamespace, setEditingNamespace] = useState<Namespace | null>(null);

  const form = useForm<NamespaceFormData>({
    resolver: zodResolver(namespaceSchema),
    defaultValues: {
      nome: "",
      slug: "",
      descricao: "",
      cor: "#3B82F6",
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
      toast({ title: "Namespace criado com sucesso" });
      setIsDialogOpen(false);
      form.reset();
    },
    onError: () => {
      toast({ title: "Erro ao criar namespace", variant: "destructive" });
    },
  });

  const updateNamespaceMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<NamespaceFormData> }) => {
      const res = await apiRequest("PATCH", `/api/namespaces/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/namespaces"] });
      toast({ title: "Namespace atualizado" });
      setIsDialogOpen(false);
      setEditingNamespace(null);
      form.reset();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar", variant: "destructive" });
    },
  });

  const deleteNamespaceMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/namespaces/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/namespaces"] });
      toast({ title: "Namespace removido" });
    },
    onError: () => {
      toast({ title: "Erro ao remover", variant: "destructive" });
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

  const handleNewNamespace = () => {
    setEditingNamespace(null);
    form.reset();
    setIsDialogOpen(true);
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
            Namespaces
          </h1>
          <p className="text-muted-foreground mt-1">
            {namespaces?.length || 0} namespaces ativos
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleNewNamespace} data-testid="button-criar-namespace">
              <Plus className="mr-2 h-4 w-4" />
              Criar Namespace
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>
                {editingNamespace ? "Editar Namespace" : "Criar Namespace"}
              </DialogTitle>
              <DialogDescription>
                Organize seus agentes e documentos em namespaces separados
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="nome"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Ex: Vendas, Suporte, Marketing"
                          {...field}
                          onChange={(e) => {
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
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Slug</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="ex: vendas, suporte"
                          {...field}
                          data-testid="input-namespace-slug"
                        />
                      </FormControl>
                      <FormDescription>
                        URL: /namespace/{field.value || "slug"}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="descricao"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descrição</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Descrição do namespace"
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
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cor</FormLabel>
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
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={createNamespaceMutation.isPending || updateNamespaceMutation.isPending}
                    data-testid="button-salvar-namespace"
                  >
                    Salvar
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
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Settings className="mr-2 h-4 w-4" />
                        Configurações
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => deleteNamespaceMutation.mutate(namespace.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remover
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
                    0 agentes
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-xs">
                    <FileText className="h-3 w-3" />
                    0 docs
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-xs">
                    <Users className="h-3 w-3" />
                    0 usuários
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
            <h3 className="font-semibold text-foreground mb-2">Nenhum namespace criado</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
              Crie namespaces para organizar seus agentes e documentos por departamento ou projeto
            </p>
            <Button onClick={handleNewNamespace} data-testid="button-criar-primeiro-namespace">
              <Plus className="mr-2 h-4 w-4" />
              Criar Namespace
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
