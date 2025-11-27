/**
 * Documents - Gestão de Documentos RAG
 * 
 * Página para upload, visualização e gestão de documentos
 * para o sistema de Retrieval-Augmented Generation.
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  Upload,
  Search,
  Trash2,
  Eye,
  CheckCircle2,
  Clock,
  AlertCircle,
  Filter,
  Grid,
  List,
  Loader2,
  FileType,
  Calendar,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

interface Document {
  id: string;
  titulo: string;
  conteudo: string;
  tipo: string | null;
  fonte: string | null;
  urlOrigem: string | null;
  processado: boolean;
  criadoEm: string;
  namespaceId: string | null;
}

interface DocumentsResponse {
  documents: Document[];
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { type: 'spring', stiffness: 100, damping: 15 },
  },
  exit: { opacity: 0, y: -10 },
};

function DocumentCard({ 
  document, 
  onView, 
  onDelete,
  viewMode,
}: { 
  document: Document;
  onView: () => void;
  onDelete: () => void;
  viewMode: 'grid' | 'list';
}) {
  const getFileIcon = (tipo: string | null) => {
    if (!tipo) return FileText;
    if (tipo.includes('pdf')) return FileType;
    return FileText;
  };

  const FileIcon = getFileIcon(document.tipo);
  const truncatedContent = document.conteudo?.slice(0, 150) + (document.conteudo?.length > 150 ? '...' : '') || '';

  if (viewMode === 'list') {
    return (
      <motion.div variants={itemVariants}>
        <Card className="hover-elevate transition-all">
          <div className="flex items-center gap-4 p-4">
            <div className="p-2 rounded-lg bg-primary/10 shrink-0">
              <FileIcon className="h-5 w-5 text-primary" />
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium truncate">{document.titulo}</h3>
                {document.processado ? (
                  <Badge variant="outline" className="bg-green-500/10 text-green-600 shrink-0">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Processado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-600 shrink-0">
                    <Clock className="h-3 w-3 mr-1" />
                    Pendente
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground truncate">{truncatedContent}</p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={onView} data-testid={`button-view-doc-${document.id}`}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Visualizar</TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={onDelete} data-testid={`button-delete-doc-${document.id}`}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Excluir</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate transition-all h-full flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileIcon className="h-5 w-5 text-primary" />
            </div>
            {document.processado ? (
              <Badge variant="outline" className="bg-green-500/10 text-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                OK
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600">
                <Clock className="h-3 w-3 mr-1" />
                Pendente
              </Badge>
            )}
          </div>
          <CardTitle className="text-base mt-3 line-clamp-1">{document.titulo}</CardTitle>
          <CardDescription className="line-clamp-2 text-xs">{truncatedContent}</CardDescription>
        </CardHeader>
        
        <CardContent className="flex-1 pb-2">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {new Date(document.criadoEm).toLocaleDateString('pt-BR')}
            </span>
            {document.tipo && (
              <span className="flex items-center gap-1">
                <FileType className="h-3 w-3" />
                {document.tipo.split('/').pop()}
              </span>
            )}
          </div>
        </CardContent>

        <CardFooter className="pt-2 gap-1">
          <Button variant="outline" size="sm" className="flex-1" onClick={onView} data-testid={`button-view-doc-${document.id}`}>
            <Eye className="h-3 w-3 mr-1" />
            Ver
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} data-testid={`button-delete-doc-${document.id}`}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
}

function UploadZone({ onUpload, isUploading }: { onUpload: (file: File) => void; isUploading: boolean }) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  }, [onUpload]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
  }, [onUpload]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
        isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50',
        isUploading && 'opacity-50 pointer-events-none'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        id="file-upload"
        className="hidden"
        onChange={handleFileChange}
        accept=".txt,.md,.pdf,.docx,.csv,.json"
        disabled={isUploading}
      />
      <label htmlFor="file-upload" className="cursor-pointer">
        <div className="flex flex-col items-center gap-3">
          {isUploading ? (
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
          ) : (
            <div className="p-3 rounded-full bg-primary/10">
              <Upload className="h-6 w-6 text-primary" />
            </div>
          )}
          <div>
            <p className="font-medium">
              {isUploading ? 'Enviando...' : 'Arraste arquivos ou clique para enviar'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Suporta: TXT, MD, PDF, DOCX, CSV, JSON (até 50MB)
            </p>
          </div>
        </div>
      </label>
    </motion.div>
  );
}

function DocumentViewer({ document, onClose }: { document: Document; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {document.titulo}
          </DialogTitle>
          <DialogDescription>
            Criado em {new Date(document.criadoEm).toLocaleDateString('pt-BR', { 
              day: '2-digit', 
              month: 'long', 
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 flex-wrap">
          {document.processado ? (
            <Badge className="bg-green-500/10 text-green-600">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Processado com embeddings
            </Badge>
          ) : (
            <Badge className="bg-amber-500/10 text-amber-600">
              <Clock className="h-3 w-3 mr-1" />
              Aguardando processamento
            </Badge>
          )}
          {document.tipo && (
            <Badge variant="outline">
              <FileType className="h-3 w-3 mr-1" />
              {document.tipo}
            </Badge>
          )}
          {document.fonte && (
            <Badge variant="outline">
              Fonte: {document.fonte}
            </Badge>
          )}
        </div>

        <ScrollArea className="h-[400px] border rounded-lg p-4 bg-muted/30">
          <pre className="whitespace-pre-wrap text-sm font-mono">{document.conteudo}</pre>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-close-viewer">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Documents() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filterStatus, setFilterStatus] = useState<'all' | 'processed' | 'pending'>('all');
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [deleteDocument, setDeleteDocument] = useState<Document | null>(null);

  const { data, isLoading, error } = useQuery<DocumentsResponse>({
    queryKey: ['/api/rag/documents'],
    staleTime: 1000 * 60,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('titulo', file.name);

      const response = await fetch('/api/rag/documents/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Falha ao enviar documento');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] });
      toast({ title: 'Documento enviado com sucesso' });
    },
    onError: () => {
      toast({ title: 'Erro ao enviar documento', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/rag/documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] });
      setDeleteDocument(null);
      toast({ title: 'Documento excluído com sucesso' });
    },
    onError: () => {
      toast({ title: 'Erro ao excluir documento', variant: 'destructive' });
    },
  });

  const documents = data?.documents || [];
  
  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = doc.titulo.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (doc.conteudo?.toLowerCase().includes(searchQuery.toLowerCase()) || false);
    
    const matchesStatus = filterStatus === 'all' ||
                          (filterStatus === 'processed' && doc.processado) ||
                          (filterStatus === 'pending' && !doc.processado);
    
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: documents.length,
    processed: documents.filter(d => d.processado).length,
    pending: documents.filter(d => !d.processado).length,
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-lg font-semibold mb-2">Erro ao carregar documentos</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Não foi possível carregar a lista de documentos. Tente novamente mais tarde.
        </p>
        <Button 
          className="mt-4" 
          onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] })}
          data-testid="button-retry-load"
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 border-b bg-background/95 backdrop-blur"
      >
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-documents-title">
              {t('documents.title') || 'Documentos RAG'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t('documents.subtitle') || 'Gerencie documentos para o sistema de recuperação aumentada'}
            </p>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="gap-1">
              <Layers className="h-3 w-3" />
              {stats.total} documentos
            </Badge>
            <Badge variant="outline" className="bg-green-500/10 text-green-600 gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {stats.processed} processados
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Card className="col-span-1 md:col-span-2">
            <CardContent className="p-4">
              <UploadZone 
                onUpload={(file) => uploadMutation.mutate(file)} 
                isUploading={uploadMutation.isPending}
              />
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Estatísticas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Processados</span>
                <span className="font-medium">{stats.processed}/{stats.total}</span>
              </div>
              <Progress value={(stats.processed / Math.max(stats.total, 1)) * 100} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{stats.pending} pendentes</span>
                <span>{Math.round((stats.processed / Math.max(stats.total, 1)) * 100)}%</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar documentos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-documents"
            />
          </div>
          
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as typeof filterStatus)}>
            <SelectTrigger className="w-[160px]" data-testid="select-filter-status">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filtrar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="processed">Processados</SelectItem>
              <SelectItem value="pending">Pendentes</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex border rounded-lg">
            <Button
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setViewMode('grid')}
              data-testid="button-view-grid"
            >
              <Grid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setViewMode('list')}
              data-testid="button-view-list"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </motion.div>

      <ScrollArea className="flex-1 p-4">
        {isLoading ? (
          <div className={cn(
            'gap-4',
            viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'flex flex-col'
          )}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className={viewMode === 'grid' ? 'h-48' : 'h-20'} />
            ))}
          </div>
        ) : filteredDocuments.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center h-64 text-center"
          >
            <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-medium mb-1">
              {searchQuery ? 'Nenhum documento encontrado' : 'Nenhum documento ainda'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {searchQuery 
                ? 'Tente buscar com outros termos ou limpe os filtros.' 
                : 'Faça upload de documentos para começar a usar o sistema RAG.'}
            </p>
          </motion.div>
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className={cn(
              'gap-4',
              viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'flex flex-col'
            )}
          >
            <AnimatePresence>
              {filteredDocuments.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  viewMode={viewMode}
                  onView={() => setSelectedDocument(doc)}
                  onDelete={() => setDeleteDocument(doc)}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </ScrollArea>

      {selectedDocument && (
        <DocumentViewer 
          document={selectedDocument} 
          onClose={() => setSelectedDocument(null)} 
        />
      )}

      {deleteDocument && (
        <Dialog open onOpenChange={() => setDeleteDocument(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirmar exclusão</DialogTitle>
              <DialogDescription>
                Tem certeza que deseja excluir o documento &quot;{deleteDocument.titulo}&quot;? 
                Esta ação não pode ser desfeita e todos os embeddings associados serão removidos.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDocument(null)} data-testid="button-cancel-delete">
                Cancelar
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => deleteMutation.mutate(deleteDocument.id)}
                disabled={deleteMutation.isPending}
                data-testid="button-confirm-delete"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
