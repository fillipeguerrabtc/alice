import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AlertTriangle,
  Eye,
  FileCheck,
  FileJson,
  Info,
  Loader2,
  Upload,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { TabsContent } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { frontendLogger } from '@/lib/logger';
import { ApiError, apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';

type Namespace = {
  id: string;
  nome: string;
  slug: string;
};

type BulkImportEntry = {
  messages: Array<{ role: string; content: string }>;
  rating?: number;
};

type BulkImportData = {
  data?: BulkImportEntry[];
};

type BulkImportResult = {
  imported: number;
  duplicates?: number;
  duplicatesSkipped?: number;
  sourceType?: string;
  errors?: Array<{ index: number; error: string }>;
};

type TrainingBulkImportTabContentProps = {
  t: (key: string, options?: Record<string, unknown>) => string;
};

export function TrainingBulkImportTabContent({ t }: TrainingBulkImportTabContentProps) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<BulkImportEntry[]>([]);
  const [source, setSource] = useState('bulk-import');
  const [namespaceId, setNamespaceId] = useState<string>('');
  const [sourceType, setSourceType] = useState<string>('external');
  const [autoApprove, setAutoApprove] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const BULK_IMPORT_SOURCE_TYPES = [
    'external',
    'chat',
    'trading_demo',
    'trading_postmortem',
    'trading_signal',
    'trading_order',
    'document',
    'rag_document',
    'rag_media',
    'upload',
    'manual',
    'system',
  ] as const;
  const { data: namespacesData } = useQuery<Namespace[]>({
    queryKey: ['/api/namespaces'],
    staleTime: 1000 * 60,
  });
  const namespaces = namespacesData ?? [];

  const bulkImportEntrySchema = z.object({
    messages: z.array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().min(1),
      }),
    ).min(2),
    rating: z.number().int().min(1).max(5).optional(),
  });

  const bulkImportSchema = z.array(bulkImportEntrySchema).max(1000);

  const bulkImport = useMutation({
    mutationFn: async (): Promise<BulkImportResult> => {
      const res = await apiRequest('POST', '/api/training/bulk-import', {
        data: parsedData,
        source: source || 'bulk-import',
        ...(namespaceId ? { namespaceId } : {}),
        sourceType,
        autoApprove,
      });
      return res.json();
    },
    onSuccess: (result) => {
      const duplicatesCount = result.duplicates ?? result.duplicatesSkipped ?? 0;
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      toast({
        title: t('training.bulkImport.success.fullSuccess', {
          imported: result.imported,
          duplicates: duplicatesCount,
        }),
      });
      setFile(null);
      setParsedData([]);
      setSource('bulk-import');
      setNamespaceId('');
      setSourceType('external');
      setAutoApprove(false);
    },
    onError: (error) => {
      frontendLogger.error('Erro ao importar dados de treinamento em massa', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        source,
        namespaceId: namespaceId || null,
        sourceType,
        autoApprove,
        entriesCount: parsedData.length,
      });
      toast({
        title: t('training.bulkImport.errors.importFailed'),
        description: error instanceof ApiError ? error.message : 'Erro desconhecido',
        variant: 'destructive',
      });
    },
  });

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);

    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile) {
      void handleFileSelect(droppedFile);
    }
  }, []);

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      void handleFileSelect(selectedFile);
    }
  };

  const handleFileSelect = async (selectedFile: File) => {
    setValidationError(null);
    setParsedData([]);

    const bulkImportMaxSize = 10 * 1024 * 1024;
    if (selectedFile.size > bulkImportMaxSize) {
      setValidationError(t('training.bulkImport.validation.fileTooLargeDesc'));
      return;
    }

    const validExtensions = ['.json', '.jsonl'];
    const fileExtension = selectedFile.name.toLowerCase().slice(selectedFile.name.lastIndexOf('.'));
    if (!validExtensions.includes(fileExtension)) {
      setValidationError(t('training.bulkImport.validation.invalidFormatDesc'));
      return;
    }

    try {
      const text = await selectedFile.text();
      let entries: BulkImportEntry[] = [];

      if (fileExtension === '.json') {
        const parsed = JSON.parse(text) as BulkImportData;
        entries = parsed.data || (Array.isArray(parsed) ? parsed : []);
      } else if (fileExtension === '.jsonl') {
        const lines = text.split('\n');
        const parsedEntries: BulkImportEntry[] = [];
        const errors: Array<{ lineNumber: number; error: string }> = [];

        lines.forEach((line, index) => {
          const trimmedLine = line.trim();
          if (!trimmedLine) return;

          const lineNumber = index + 1;
          try {
            const parsed = JSON.parse(trimmedLine) as BulkImportEntry;
            parsedEntries.push(parsed);
          } catch (parseError) {
            const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
            errors.push({ lineNumber, error: errorMessage });

            frontendLogger.error('Erro ao fazer parse de linha JSONL', {
              lineNumber,
              lineContent: trimmedLine.substring(0, 100),
              error: errorMessage,
              fileName: selectedFile.name,
            });
          }
        });

        if (errors.length > 0) {
          const firstError = errors[0];
          setValidationError(
            t('training.bulkImport.errors.jsonlParseErrorDesc', {
              lineNumber: firstError.lineNumber,
              error: firstError.error,
            }),
          );

          frontendLogger.error('Falha ao processar arquivo JSONL - múltiplas linhas com erro', {
            totalErrors: errors.length,
            errors: errors.map((item) => ({ line: item.lineNumber, error: item.error })),
            fileName: selectedFile.name,
            totalLines: lines.length,
            successfulParses: parsedEntries.length,
          });

          return;
        }

        entries = parsedEntries;
      }

      if (entries.length > 1000) {
        setValidationError(t('training.bulkImport.validation.tooManyEntriesDesc'));
        return;
      }

      const validationResult = bulkImportSchema.safeParse(entries);
      if (!validationResult.success) {
        const firstError = validationResult.error.errors[0];
        setValidationError(firstError?.message || t('training.bulkImport.validation.missingMessagesDesc'));
        return;
      }

      setFile(selectedFile);
      setParsedData(entries);
    } catch (error) {
      frontendLogger.error('Erro ao fazer parse do arquivo de bulk import', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileType: selectedFile.type,
      });
      setValidationError(t('training.bulkImport.errors.parseError'));
    }
  };

  const handleClearFile = () => {
    setFile(null);
    setParsedData([]);
    setValidationError(null);
  };

  return (
    <TabsContent value="bulk-import" className="flex-1 m-0">
      <div className="flex-1 p-4 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              {t('training.bulkImport.title')}
            </CardTitle>
            <CardDescription>
              {t('training.bulkImport.subtitle')}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                'border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer',
                isDragging
                  ? 'border-primary bg-primary/5 scale-[1.02]'
                  : file
                    ? 'border-green-500 bg-green-500/5'
                    : 'border-muted-foreground/25 hover:border-primary hover:bg-muted/50',
              )}
              onClick={() => document.getElementById('bulk-import-file')?.click()}
            >
              <input
                id="bulk-import-file"
                type="file"
                accept=".json,.jsonl"
                className="hidden"
                onChange={handleFileInputChange}
              />

              {file ? (
                <div className="space-y-2">
                  <FileCheck className="h-12 w-12 text-green-500 mx-auto" />
                  <div>
                    <p className="font-medium text-green-600">
                      {t('training.bulkImport.fileSelected')}
                    </p>
                    <p className="text-sm text-muted-foreground">{file.name}</p>
                    <Badge variant="outline" className="mt-2 bg-green-500/10 text-green-600">
                      {t('training.bulkImport.entries', { count: parsedData.length })}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleClearFile();
                    }}
                    className="mt-2"
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <FileJson className={cn(
                    'h-12 w-12 mx-auto transition-colors',
                    isDragging ? 'text-primary' : 'text-muted-foreground/50',
                  )}
                  />
                  <div>
                    <p className="font-medium">
                      {t('training.bulkImport.dragDrop')}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('training.bulkImport.or')} {t('training.bulkImport.browse')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {t('training.bulkImport.supportedFormats')}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {validationError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t('training.bulkImport.validation.invalidFormat')}</AlertTitle>
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}

            {parsedData.length > 0 && (
              <div className="space-y-4 pt-4 border-t">
                <div className="space-y-2">
                  <Label htmlFor="import-source">{t('training.bulkImport.source')}</Label>
                  <Input
                    id="import-source"
                    placeholder={t('training.bulkImport.sourcePlaceholder')}
                    value={source}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSource(event.target.value)}
                    maxLength={50}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="import-namespace">Namespace</Label>
                  <Select value={namespaceId || '__none__'} onValueChange={(value) => setNamespaceId(value === '__none__' ? '' : value)}>
                    <SelectTrigger id="import-namespace">
                      <SelectValue placeholder="Selecionar namespace" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sem namespace explícito</SelectItem>
                      {namespaces.map((namespace) => (
                        <SelectItem key={namespace.id} value={namespace.id}>
                          {namespace.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="import-source-type">Source Type</Label>
                  <Select value={sourceType} onValueChange={setSourceType}>
                    <SelectTrigger id="import-source-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BULK_IMPORT_SOURCE_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="space-y-0.5">
                    <Label htmlFor="auto-approve" className="font-medium">
                      {t('training.bulkImport.autoApprove')}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t('training.bulkImport.autoApproveDesc')}
                    </p>
                  </div>
                  <Switch
                    id="auto-approve"
                    checked={autoApprove}
                    onCheckedChange={setAutoApprove}
                  />
                </div>
              </div>
            )}
          </CardContent>

          {parsedData.length > 0 && (
            <CardFooter className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={handleClearFile}
                disabled={bulkImport.isPending}
              >
                {t('training.bulkImport.cancel')}
              </Button>
              <Button
                onClick={() => bulkImport.mutate()}
                disabled={bulkImport.isPending || parsedData.length === 0}
              >
                {bulkImport.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {t('training.bulkImport.importing')}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    {t('training.bulkImport.import', { count: parsedData.length })}
                  </>
                )}
              </Button>
            </CardFooter>
          )}
        </Card>

        {parsedData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                {t('training.bulkImport.preview')}
              </CardTitle>
              <CardDescription>
                {t('training.bulkImport.showingFirst', {
                  count: Math.min(5, parsedData.length),
                  total: parsedData.length,
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-3">
                  {parsedData.slice(0, 5).map((entry, idx) => (
                    <Card key={idx} className="bg-muted/30">
                      <CardContent className="p-3 space-y-2">
                        {entry.messages.map((msg, msgIdx) => (
                          <div
                            key={msgIdx}
                            className={cn(
                              'text-xs p-2 rounded',
                              msg.role === 'user' ? 'bg-background' : 'bg-primary/5',
                            )}
                          >
                            <span className="font-medium capitalize">{msg.role}:</span>{' '}
                            <span className="text-muted-foreground">
                              {msg.content.slice(0, 200)}
                              {msg.content.length > 200 ? '...' : ''}
                            </span>
                          </div>
                        ))}
                        {entry.rating && (
                          <Badge variant="secondary" className="text-xs">
                            Rating: {entry.rating}/5
                          </Badge>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                  {parsedData.length > 5 && (
                    <p className="text-center text-sm text-muted-foreground">
                      +{parsedData.length - 5} {t('training.bulkImport.entries', { count: parsedData.length - 5 })}
                    </p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {parsedData.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" />
                {t('training.bulkImport.help.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">
                  {t('training.bulkImport.help.jsonExample')}
                </p>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{`{
  "data": [
    {
      "messages": [
        {"role": "user", "content": "Como funciona X?"},
        {"role": "assistant", "content": "X funciona..."}
      ],
      "rating": 5
    }
  ]
}`}
                </pre>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">
                  {t('training.bulkImport.help.jsonlExample')}
                </p>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{`{"messages": [{"role": "user", "content": "Pergunta 1"}, {"role": "assistant", "content": "Resposta 1"}], "rating": 5}
{"messages": [{"role": "user", "content": "Pergunta 2"}, {"role": "assistant", "content": "Resposta 2"}], "rating": 4}`}
                </pre>
              </div>

              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium mb-1">
                    {t('training.bulkImport.help.requiredFields')}
                  </p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-1">
                    <li>{t('training.bulkImport.help.messagesField')}</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium mb-1">
                    {t('training.bulkImport.help.optionalFields')}
                  </p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-1">
                    <li>{t('training.bulkImport.help.ratingField')}</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </TabsContent>
  );
}
