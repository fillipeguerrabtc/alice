import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { 
  Image, 
  Star, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Zap,
  Timer,
  Download,
} from "lucide-react";

interface GeneratedImage {
  id: string;
  tenantId: string | null;
  conversationId: string | null;
  messageId: string | null;
  createdBy: string | null;
  prompt: string;
  negativePrompt: string | null;
  model: string;
  steps: number;
  seed: number | null;
  width: number;
  height: number;
  guidanceScale: number | null;
  status: "pending" | "generating" | "completed" | "failed";
  imagePath: string | null;
  thumbnailPath: string | null;
  imageUrl: string | null;
  feedbackScore: number | null;
  approvedForTraining: boolean | null;
  usedInFineTuning: boolean | null;
  generationTimeMs: number | null;
  errorMessage: string | null;
  criadoEm: string;
  conversation?: {
    id: string;
    titulo: string | null;
  } | null;
}

interface ImagesResponse {
  images: GeneratedImage[];
  total: number;
  offset: number;
  limit: number;
}

interface StatsResponse {
  total: number;
  completed: number;
  pending: number;
  failed: number;
  approvedForTraining: number;
  usedInFineTuning: number;
  averageGenerationTimeMs: number;
  circuitBreaker: {
    state: string;
    stats: {
      failures: number;
      successes: number;
      timeouts: number;
    };
  };
}

function StatusBadge({ status }: { status: GeneratedImage["status"] }) {
  const statusConfig = {
    pending: { label: "Pendente", variant: "secondary" as const, icon: Clock },
    generating: { label: "Gerando", variant: "default" as const, icon: Sparkles },
    completed: { label: "Concluída", variant: "default" as const, icon: CheckCircle2 },
    failed: { label: "Falha", variant: "destructive" as const, icon: AlertCircle },
  };
  
  const config = statusConfig[status];
  const Icon = config.icon;
  
  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

function ApprovalBadge({ approved }: { approved: boolean | null }) {
  if (approved === null) {
    return (
      <Badge variant="outline" className="gap-1">
        <Clock className="h-3 w-3" />
        Aguardando
      </Badge>
    );
  }
  
  return approved ? (
    <Badge variant="default" className="gap-1 bg-green-600">
      <CheckCircle2 className="h-3 w-3" />
      Aprovada
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" />
      Rejeitada
    </Badge>
  );
}

function StarRating({ 
  value, 
  onChange, 
  readonly = false 
}: { 
  value: number | null; 
  onChange?: (value: number) => void;
  readonly?: boolean;
}) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => !readonly && setHoverValue(star)}
          onMouseLeave={() => setHoverValue(null)}
          className={`${readonly ? 'cursor-default' : 'cursor-pointer'}`}
          data-testid={`button-star-${star}`}
        >
          <Star
            className={`h-5 w-5 transition-colors ${
              (hoverValue ?? value ?? 0) >= star
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function ImageCard({ 
  image, 
  onSelect 
}: { 
  image: GeneratedImage; 
  onSelect: (image: GeneratedImage) => void;
}) {
  return (
    <Card 
      className="hover-elevate cursor-pointer overflow-visible"
      onClick={() => onSelect(image)}
      data-testid={`card-image-${image.id}`}
    >
      <div className="relative aspect-square bg-muted rounded-t-md overflow-hidden">
        {image.status === "completed" && image.imageUrl ? (
          <img
            src={image.imageUrl}
            alt={image.prompt.substring(0, 100)}
            className="w-full h-full object-cover"
            data-testid={`img-generated-${image.id}`}
          />
        ) : image.status === "generating" ? (
          <div className="flex items-center justify-center h-full">
            <Sparkles className="h-12 w-12 text-muted-foreground animate-pulse" />
          </div>
        ) : image.status === "failed" ? (
          <div className="flex items-center justify-center h-full">
            <AlertCircle className="h-12 w-12 text-destructive" />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <Clock className="h-12 w-12 text-muted-foreground" />
          </div>
        )}
      </div>
      <CardContent className="p-3">
        <p className="text-sm line-clamp-2 mb-2" data-testid={`text-prompt-${image.id}`}>
          {image.prompt}
        </p>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <StatusBadge status={image.status} />
          {image.status === "completed" && (
            <ApprovalBadge approved={image.approvedForTraining} />
          )}
        </div>
        {image.feedbackScore && (
          <div className="mt-2">
            <StarRating value={image.feedbackScore} readonly />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ImageDetailModal({ 
  image, 
  open, 
  onClose 
}: { 
  image: GeneratedImage | null; 
  open: boolean; 
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [rating, setRating] = useState<number | null>(null);
  
  const rateMutation = useMutation({
    mutationFn: async (score: number) => {
      const res = await apiRequest("POST", `/api/chat/images/${image?.id}/rate`, { score });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/images"] });
      toast({ title: "Avaliação registrada", description: "Obrigado pelo feedback!" });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao registrar avaliação", variant: "destructive" });
    },
  });
  
  const approveMutation = useMutation({
    mutationFn: async (approved: boolean) => {
      const res = await apiRequest("POST", `/api/chat/images/${image?.id}/approve`, { approved });
      return res.json();
    },
    onSuccess: (_data, approved) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/images"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/images/stats"] });
      toast({ 
        title: approved ? "Imagem aprovada" : "Imagem rejeitada", 
        description: approved ? "Será usada no próximo fine-tuning" : "Não será usada no treinamento"
      });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao processar aprovação", variant: "destructive" });
    },
  });
  
  if (!image) return null;
  
  const handleDownload = () => {
    if (image.imageUrl) {
      const link = document.createElement('a');
      link.href = image.imageUrl;
      link.download = `image-${image.id}.png`;
      link.click();
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Image className="h-5 w-5" />
            Detalhes da Imagem
          </DialogTitle>
          <DialogDescription>
            Gerada em {new Date(image.criadoEm).toLocaleString('pt-BR')}
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative aspect-square bg-muted rounded-md overflow-hidden">
            {image.status === "completed" && image.imageUrl ? (
              <img
                src={image.imageUrl}
                alt={image.prompt}
                className="w-full h-full object-contain"
                data-testid="img-modal-preview"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <Sparkles className="h-16 w-16 text-muted-foreground animate-pulse" />
              </div>
            )}
          </div>
          
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-1">Prompt</h4>
                <p className="text-sm text-muted-foreground" data-testid="text-modal-prompt">
                  {image.prompt}
                </p>
              </div>
              
              {image.negativePrompt && (
                <div>
                  <h4 className="font-medium mb-1">Negative Prompt</h4>
                  <p className="text-sm text-muted-foreground">
                    {image.negativePrompt}
                  </p>
                </div>
              )}
              
              <Separator />
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <h4 className="text-sm font-medium mb-1">Modelo</h4>
                  <Badge variant="outline">{image.model}</Badge>
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-1">Status</h4>
                  <StatusBadge status={image.status} />
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-1">Dimensões</h4>
                  <p className="text-sm text-muted-foreground">{image.width}x{image.height}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-1">Steps</h4>
                  <p className="text-sm text-muted-foreground">{image.steps}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-1">Seed</h4>
                  <p className="text-sm text-muted-foreground">{image.seed || "Random"}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-1">Guidance Scale</h4>
                  <p className="text-sm text-muted-foreground">{image.guidanceScale}</p>
                </div>
                {image.generationTimeMs && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Tempo de Geração</h4>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <Timer className="h-3 w-3" />
                      {(image.generationTimeMs / 1000).toFixed(2)}s
                    </p>
                  </div>
                )}
              </div>
              
              {image.status === "failed" && image.errorMessage && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-medium mb-1 text-destructive">Erro</h4>
                    <p className="text-sm text-muted-foreground">{image.errorMessage}</p>
                  </div>
                </>
              )}
              
              {image.status === "completed" && (
                <>
                  <Separator />
                  
                  <div>
                    <h4 className="font-medium mb-2">Avaliação</h4>
                    <StarRating 
                      value={rating ?? image.feedbackScore} 
                      onChange={(score) => {
                        setRating(score);
                        rateMutation.mutate(score);
                      }} 
                    />
                  </div>
                  
                  <div>
                    <h4 className="font-medium mb-2">Aprovação para Treinamento</h4>
                    <div className="flex items-center gap-2 flex-wrap">
                      <ApprovalBadge approved={image.approvedForTraining} />
                      {image.usedInFineTuning && (
                        <Badge variant="outline" className="gap-1">
                          <Zap className="h-3 w-3" />
                          Usado em Fine-tuning
                        </Badge>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        </div>
        
        <DialogFooter className="gap-2 flex-wrap">
          {image.status === "completed" && image.imageUrl && (
            <Button variant="outline" onClick={handleDownload} data-testid="button-download-image">
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          )}
          
          {image.status === "completed" && !image.usedInFineTuning && (
            <>
              <Button
                variant="destructive"
                onClick={() => approveMutation.mutate(false)}
                disabled={approveMutation.isPending || image.approvedForTraining === false}
                data-testid="button-reject-training"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Rejeitar
              </Button>
              <Button
                onClick={() => approveMutation.mutate(true)}
                disabled={approveMutation.isPending || image.approvedForTraining === true}
                data-testid="button-approve-training"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Aprovar para Training
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatsCards({ stats }: { stats: StatsResponse | undefined }) {
  if (!stats) return null;
  
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Image className="h-4 w-4" />
            <span className="text-sm">Total</span>
          </div>
          <p className="text-2xl font-bold" data-testid="text-stat-total">{stats.total}</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-sm">Aprovadas</span>
          </div>
          <p className="text-2xl font-bold" data-testid="text-stat-approved">{stats.approvedForTraining}</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Zap className="h-4 w-4 text-yellow-500" />
            <span className="text-sm">Em Fine-tuning</span>
          </div>
          <p className="text-2xl font-bold" data-testid="text-stat-finetuning">{stats.usedInFineTuning}</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Timer className="h-4 w-4" />
            <span className="text-sm">Tempo Médio</span>
          </div>
          <p className="text-2xl font-bold" data-testid="text-stat-avgtime">
            {(stats.averageGenerationTimeMs / 1000).toFixed(1)}s
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ImageGalleryPage() {
  const { user } = useAuth();
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterApproved, setFilterApproved] = useState<string>("all");
  const [page, setPage] = useState(0);
  const pageSize = 12;
  
  const buildQueryParams = () => {
    const params = new URLSearchParams();
    if (filterStatus !== "all") params.set("status", filterStatus);
    if (filterApproved !== "all") params.set("approved", filterApproved);
    params.set("limit", String(pageSize));
    params.set("offset", String(page * pageSize));
    return params.toString();
  };
  
  const { data: imagesData, isLoading } = useQuery<ImagesResponse>({
    queryKey: ["/api/chat/images", filterStatus, filterApproved, page],
    queryFn: async () => {
      const queryString = buildQueryParams();
      const response = await fetch(`/api/chat/images?${queryString}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Falha ao carregar imagens");
      return response.json();
    },
    enabled: !!user,
  });
  
  const { data: statsData } = useQuery<StatsResponse>({
    queryKey: ["/api/chat/images/stats"],
    enabled: !!user,
  });
  
  const images = imagesData?.images ?? [];
  const totalPages = Math.ceil((imagesData?.total ?? 0) / pageSize);
  
  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Sparkles className="h-6 w-6" />
            Galeria de Imagens
          </h1>
          <p className="text-muted-foreground">
            Imagens geradas pelo FLUX.1 Schnell
          </p>
        </div>
      </div>
      
      <StatsCards stats={statsData} />
      
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status:</span>
              <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(0); }}>
                <SelectTrigger className="w-[150px]" data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="completed">Concluídas</SelectItem>
                  <SelectItem value="generating">Gerando</SelectItem>
                  <SelectItem value="pending">Pendentes</SelectItem>
                  <SelectItem value="failed">Falhas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Aprovação:</span>
              <Select value={filterApproved} onValueChange={(v) => { setFilterApproved(v); setPage(0); }}>
                <SelectTrigger className="w-[180px]" data-testid="select-approval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="true">Aprovadas</SelectItem>
                  <SelectItem value="false">Rejeitadas</SelectItem>
                  <SelectItem value="pending">Aguardando</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="aspect-square" />
              <CardContent className="p-3">
                <Skeleton className="h-10 w-full mb-2" />
                <Skeleton className="h-6 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : images.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Image className="h-16 w-16 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center" data-testid="text-no-images">
              Nenhuma imagem encontrada.
              <br />
              As imagens geradas durante conversas aparecerão aqui.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
            {images.map((image) => (
              <ImageCard key={image.id} image={image} onSelect={setSelectedImage} />
            ))}
          </div>
          
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground" data-testid="text-page-info">
                Página {page + 1} de {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                data-testid="button-next-page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
      
      <ImageDetailModal
        image={selectedImage}
        open={!!selectedImage}
        onClose={() => setSelectedImage(null)}
      />
    </div>
  );
}
