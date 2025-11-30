/**
 * Página de Gestão de Módulos do Sistema - Alice Enterprise Platform
 * 
 * Painel de administração para gerenciar módulos do sistema (RBAC granular).
 * Permite criar, editar, deletar módulos e atribuir a roles/usuários.
 * 
 * Regra 6: Dados reais via API PostgreSQL (sem mocks)
 * Regra 10: Documentação PT-BR
 * Regra 13: Internacionalização i18next
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  Boxes,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Shield,
  Users,
  CheckCircle2,
  XCircle,
  Loader2,
  LayoutDashboard,
  MessageSquare,
  FileText,
  CreditCard,
  Settings,
  BarChart3,
  Bot,
  Image,
  Zap,
} from 'lucide-react';
interface SystemModule {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  icone: string | null;
  categoria: string;
  urlExterna: string | null;
  ordem: number | null;
  ativo: boolean | null;
  criadoEm: Date | null;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: 'spring', stiffness: 100, damping: 12 },
  },
};

interface ModuleFormData {
  codigo: string;
  nome: string;
  descricao?: string;
  icone?: string;
  categoria: string;
  urlExterna?: string;
  ordem?: number;
  ativo?: boolean;
}

const moduleFormSchema: z.ZodType<ModuleFormData> = z.object({
  codigo: z.string().min(2, 'Código deve ter pelo menos 2 caracteres').max(100),
  nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(255),
  descricao: z.string().optional(),
  icone: z.string().max(50).optional(),
  categoria: z.string().min(2, 'Categoria é obrigatória').max(100),
  urlExterna: z.string().url('URL inválida').optional().or(z.literal('')),
  ordem: z.coerce.number().int().optional(),
  ativo: z.boolean().optional(),
}) as z.ZodType<ModuleFormData>;

const ICON_OPTIONS = [
  { value: 'LayoutDashboard', label: 'Dashboard', icon: LayoutDashboard },
  { value: 'MessageSquare', label: 'Chat', icon: MessageSquare },
  { value: 'FileText', label: 'Documentos', icon: FileText },
  { value: 'CreditCard', label: 'Pagamentos', icon: CreditCard },
  { value: 'Settings', label: 'Configurações', icon: Settings },
  { value: 'BarChart3', label: 'Relatórios', icon: BarChart3 },
  { value: 'Bot', label: 'Agentes', icon: Bot },
  { value: 'Image', label: 'Imagens', icon: Image },
  { value: 'Zap', label: 'Integrações', icon: Zap },
  { value: 'Shield', label: 'Segurança', icon: Shield },
  { value: 'Users', label: 'Usuários', icon: Users },
  { value: 'Boxes', label: 'Módulos', icon: Boxes },
];

const CATEGORY_OPTIONS = [
  'core',
  'ai',
  'integrations',
  'observability',
  'admin',
  'finance',
];

const ROLE_OPTIONS = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Administrador' },
  { value: 'manager', label: 'Gerente' },
  { value: 'operator', label: 'Operador' },
  { value: 'viewer', label: 'Visualizador' },
  { value: 'guest', label: 'Convidado' },
];

function getIconComponent(iconName: string | null | undefined) {
  const iconDef = ICON_OPTIONS.find(opt => opt.value === iconName);
  return iconDef?.icon || Boxes;
}

function ModuleCard({ 
  module, 
  onEdit, 
  onDelete 
}: { 
  module: SystemModule; 
  onEdit: (module: SystemModule) => void;
  onDelete: (id: string) => void;
}) {
  const IconComponent = getIconComponent(module.icone);
  
  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate transition-all duration-200">
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10">
              <IconComponent className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base" data-testid={`text-module-name-${module.id}`}>
                {module.nome}
              </CardTitle>
              <CardDescription className="text-xs">
                <code className="bg-muted px-1 rounded">{module.codigo}</code>
              </CardDescription>
            </div>
          </div>
          <Badge 
            variant={module.ativo ? 'default' : 'secondary'}
            data-testid={`badge-module-status-${module.id}`}
          >
            {module.ativo ? 'Ativo' : 'Inativo'}
          </Badge>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
            {module.descricao || 'Sem descrição'}
          </p>
          <div className="flex items-center justify-between gap-2">
            <Badge variant="outline" className="text-xs">
              {module.categoria}
            </Badge>
            <div className="flex items-center gap-1">
              {module.urlExterna && (
                <Button
                  variant="ghost"
                  size="icon"
                  asChild
                  data-testid={`button-module-link-${module.id}`}
                >
                  <a href={module.urlExterna} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onEdit(module)}
                data-testid={`button-edit-module-${module.id}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    data-testid={`button-delete-module-${module.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                    <AlertDialogDescription>
                      Tem certeza que deseja excluir o módulo "{module.nome}"? 
                      Esta ação não pode ser desfeita e removerá todas as atribuições.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => onDelete(module.id)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Excluir
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ModuleFormDialog({
  open,
  onOpenChange,
  module,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  module?: SystemModule | null;
  onSubmit: (data: ModuleFormData) => void;
  isLoading: boolean;
}) {
  const form = useForm<ModuleFormData>({
    resolver: zodResolver(moduleFormSchema),
    defaultValues: {
      codigo: module?.codigo || '',
      nome: module?.nome || '',
      descricao: module?.descricao || '',
      icone: module?.icone || 'Boxes',
      categoria: module?.categoria || 'core',
      urlExterna: module?.urlExterna || '',
      ordem: module?.ordem ?? 0,
      ativo: module?.ativo ?? true,
    },
  });

  const handleSubmit = (data: ModuleFormData) => {
    onSubmit({
      ...data,
      urlExterna: data.urlExterna || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {module ? 'Editar Módulo' : 'Novo Módulo'}
          </DialogTitle>
          <DialogDescription>
            {module 
              ? 'Atualize as informações do módulo do sistema.'
              : 'Crie um novo módulo para controlar acesso a funcionalidades.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="codigo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="chat-module" 
                        {...field} 
                        disabled={!!module}
                        data-testid="input-module-codigo"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Chat IA" 
                        {...field}
                        data-testid="input-module-nome"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="descricao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Descreva o propósito deste módulo..."
                      className="resize-none"
                      {...field}
                      data-testid="input-module-descricao"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="icone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ícone</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-module-icone">
                          <SelectValue placeholder="Selecione um ícone" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ICON_OPTIONS.map(({ value, label, icon: Icon }) => (
                          <SelectItem key={value} value={value}>
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4" />
                              <span>{label}</span>
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
                name="categoria"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoria</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-module-categoria">
                          <SelectValue placeholder="Selecione uma categoria" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CATEGORY_OPTIONS.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat.charAt(0).toUpperCase() + cat.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="urlExterna"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL Externa (opcional)</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="https://grafana.example.com"
                      {...field}
                      data-testid="input-module-url"
                    />
                  </FormControl>
                  <FormDescription>
                    Para módulos que redirecionam para sistemas externos
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="ordem"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ordem</FormLabel>
                    <FormControl>
                      <Input 
                        type="number"
                        {...field}
                        data-testid="input-module-ordem"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ativo"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Ativo</FormLabel>
                      <FormDescription className="text-xs">
                        Módulo disponível para uso
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-module-ativo"
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
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isLoading}
                data-testid="button-save-module"
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {module ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function RoleModulesTab() {
  const [selectedRole, setSelectedRole] = useState<string>('admin');
  const { toast } = useToast();

  const { data: modulesData, isLoading: modulesLoading } = useQuery<{ modules: SystemModule[] }>({
    queryKey: ['/api/auth/modules'],
  });

  const { data: roleModulesData } = useQuery<{ roleModules: Array<{ moduleId: string }> }>({
    queryKey: ['/api/auth/roles', selectedRole, 'modules'],
    enabled: !!selectedRole,
  });

  const { t } = useTranslation();
  
  const assignMutation = useMutation({
    mutationFn: async ({ moduleId, role }: { moduleId: string; role: string }) => {
      return apiRequest('POST', `/api/auth/roles/${role}/modules`, { moduleId, acessoLeitura: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/roles', selectedRole, 'modules'] });
      toast({ title: t('modules.success.assigned') });
    },
    onError: () => {
      toast({ title: t('modules.errors.assign'), variant: 'destructive' });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: async ({ moduleId, role }: { moduleId: string; role: string }) => {
      return apiRequest('DELETE', `/api/auth/roles/${role}/modules/${moduleId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/roles', selectedRole, 'modules'] });
      toast({ title: t('modules.success.unassigned') });
    },
    onError: () => {
      toast({ title: t('modules.errors.unassign'), variant: 'destructive' });
    },
  });

  const assignedModuleIds = new Set(
    roleModulesData?.roleModules?.map(rm => rm.moduleId) || []
  );

  if (modulesLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Label>Role:</Label>
        <Select value={selectedRole} onValueChange={setSelectedRole}>
          <SelectTrigger className="w-[200px]" data-testid="select-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="h-[400px]">
        <div className="space-y-2">
          {modulesData?.modules?.map((module) => (
            <div
              key={module.id}
              className="flex items-center justify-between p-3 rounded-md border bg-card"
            >
              <div className="flex items-center gap-3">
                {assignedModuleIds.has(module.id) ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-muted-foreground" />
                )}
                <div>
                  <p className="font-medium">{module.nome}</p>
                  <p className="text-xs text-muted-foreground">{module.codigo}</p>
                </div>
              </div>
              <Button
                variant={assignedModuleIds.has(module.id) ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => {
                  if (assignedModuleIds.has(module.id)) {
                    unassignMutation.mutate({ moduleId: module.id, role: selectedRole });
                  } else {
                    assignMutation.mutate({ moduleId: module.id, role: selectedRole });
                  }
                }}
                disabled={assignMutation.isPending || unassignMutation.isPending}
                data-testid={`button-assign-module-${module.id}`}
              >
                {assignedModuleIds.has(module.id) ? t('common.remove') : t('modules.assign')}
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export default function ModulesAdmin() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedModule, setSelectedModule] = useState<SystemModule | null>(null);

  const { data, isLoading, error } = useQuery<{ modules: SystemModule[] }>({
    queryKey: ['/api/auth/modules'],
  });

  const createMutation = useMutation({
    mutationFn: async (moduleData: ModuleFormData) => {
      return apiRequest('POST', '/api/auth/modules', moduleData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/modules'] });
      setIsFormOpen(false);
      setSelectedModule(null);
      toast({ title: t('modules.success.created') });
    },
    onError: (error: Error) => {
      toast({ 
        title: t('modules.errors.create'), 
        description: error.message,
        variant: 'destructive' 
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, moduleData }: { id: string; moduleData: ModuleFormData }) => {
      return apiRequest('PATCH', `/api/auth/modules/${id}`, moduleData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/modules'] });
      setIsFormOpen(false);
      setSelectedModule(null);
      toast({ title: t('modules.success.updated') });
    },
    onError: (error: Error) => {
      toast({ 
        title: t('modules.errors.update'),
        description: error.message,
        variant: 'destructive' 
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/auth/modules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/modules'] });
      toast({ title: t('modules.success.deleted') });
    },
    onError: (error: Error) => {
      toast({ 
        title: t('modules.errors.delete'),
        description: error.message,
        variant: 'destructive' 
      });
    },
  });

  const handleEdit = (module: SystemModule) => {
    setSelectedModule(module);
    setIsFormOpen(true);
  };

  const handleSubmit = (formData: ModuleFormData) => {
    if (selectedModule) {
      updateMutation.mutate({ id: selectedModule.id, moduleData: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const modules = data?.modules || [];
  const groupedModules = modules.reduce((acc, module) => {
    const category = module.categoria || 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(module);
    return acc;
  }, {} as Record<string, SystemModule[]>);

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
              {t('modules.title')}
            </h1>
            <p className="text-muted-foreground">
              {t('modules.description')}
            </p>
          </div>
          <Button
            onClick={() => {
              setSelectedModule(null);
              setIsFormOpen(true);
            }}
            data-testid="button-new-module"
          >
            <Plus className="mr-2 h-4 w-4" />
            Novo Módulo
          </Button>
        </div>

        <Tabs defaultValue="modules" className="space-y-4">
          <TabsList>
            <TabsTrigger value="modules" data-testid="tab-modules">
              <Boxes className="mr-2 h-4 w-4" />
              Módulos
            </TabsTrigger>
            <TabsTrigger value="roles" data-testid="tab-roles">
              <Shield className="mr-2 h-4 w-4" />
              Permissões por Role
            </TabsTrigger>
          </TabsList>

          <TabsContent value="modules" className="space-y-6">
            {isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i}>
                    <CardHeader className="space-y-2">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-4 w-24" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-12 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : error ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <XCircle className="h-12 w-12 text-destructive mb-4" />
                  <p className="text-lg font-medium">Erro ao carregar módulos</p>
                  <p className="text-muted-foreground">Tente novamente mais tarde</p>
                </CardContent>
              </Card>
            ) : modules.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Boxes className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-lg font-medium">Nenhum módulo cadastrado</p>
                  <p className="text-muted-foreground mb-4">
                    Crie o primeiro módulo para começar
                  </p>
                  <Button
                    onClick={() => {
                      setSelectedModule(null);
                      setIsFormOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Criar Módulo
                  </Button>
                </CardContent>
              </Card>
            ) : (
              Object.entries(groupedModules).map(([category, categoryModules]) => (
                <div key={category}>
                  <h2 className="text-lg font-semibold mb-3 capitalize">
                    {category}
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {categoryModules.map((module) => (
                      <ModuleCard
                        key={module.id}
                        module={module}
                        onEdit={handleEdit}
                        onDelete={(id) => deleteMutation.mutate(id)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="roles">
            <Card>
              <CardHeader>
                <CardTitle>Permissões por Role</CardTitle>
                <CardDescription>
                  Atribua módulos a roles para controlar o acesso dos usuários
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RoleModulesTab />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </motion.div>

      <ModuleFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        module={selectedModule}
        onSubmit={handleSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
