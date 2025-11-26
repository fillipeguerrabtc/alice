import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { FileText, Upload, Search, Trash2, Eye, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { formatDateTime } from '@/lib/utils';

interface Document {
  id: string;
  titulo: string;
  tipo?: string;
  fonte?: string;
  processado: boolean;
  criadoEm: string;
}

export default function Documents() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const { data, isLoading } = useQuery<{ documents: Document[] }>({
    queryKey: ['/api/rag/documents'],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/rag/documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] });
      toast({ title: 'Documento excluído com sucesso' });
    },
    onError: () => {
      toast({ title: 'Erro ao excluir documento', variant: 'destructive' });
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('titulo', file.name);

    try {
      const res = await fetch('/api/rag/documents/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!res.ok) throw new Error('Upload failed');

      queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] });
      toast({ title: 'Documento enviado com sucesso' });
    } catch {
      toast({ title: 'Erro ao enviar documento', variant: 'destructive' });
    } finally {
      setIsUploading(false);
    }
  };

  const documents = data?.documents || [];
  const filteredDocuments = documents.filter((doc) =>
    doc.titulo.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
            Documentos
          </h1>
          <p className="text-muted-foreground">
            Base de conhecimento RAG para a Alice IA
          </p>
        </div>
        <div className="flex gap-2">
          <label>
            <input
              type="file"
              className="hidden"
              onChange={handleFileUpload}
              accept=".txt,.md,.pdf,.doc,.docx"
              disabled={isUploading}
            />
            <Button asChild disabled={isUploading} data-testid="button-upload-document">
              <span>
                {isUploading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Upload Documento
              </span>
            </Button>
          </label>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar documentos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-md border bg-background text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            data-testid="input-search-documents"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredDocuments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Nenhum documento encontrado</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              {searchQuery
                ? 'Nenhum documento corresponde à sua busca.'
                : 'Faça upload de documentos para alimentar a base de conhecimento da Alice.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredDocuments.map((doc) => (
            <Card key={doc.id} className="hover-elevate" data-testid={`card-document-${doc.id}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base truncate" title={doc.titulo}>
                  {doc.titulo}
                </CardTitle>
                <CardDescription>
                  {doc.tipo || 'Texto'} • {formatDateTime(doc.criadoEm)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      doc.processado
                        ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                        : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                    }`}
                  >
                    {doc.processado ? 'Processado' : 'Pendente'}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" data-testid={`button-view-${doc.id}`}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMutation.mutate(doc.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-${doc.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
