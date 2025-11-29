import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  MessageSquare,
  Clock,
  AlertTriangle,
  User,
  Bot,
  Send,
  ArrowLeftRight,
  UserCheck,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Timer,
  MessageCircle,
  Headphones,
  Zap,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'human';
  content: string;
  timestamp: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
}

interface PendingConversation {
  id: string;
  customerId: string;
  customerName: string;
  customerAvatar?: string;
  channel: 'web' | 'whatsapp' | 'api';
  status: 'pending' | 'in_progress' | 'resolved';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  waitTime: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  lastMessage: string;
  messageCount: number;
  aiConfidence: number;
  escalationReason?: string;
  assignedTo?: string;
  slaStatus: 'on_track' | 'at_risk' | 'breached';
  createdAt: string;
}

interface ConversationDetail extends PendingConversation {
  messages: ConversationMessage[];
  customerHistory: {
    totalConversations: number;
    resolvedByAI: number;
    avgSatisfaction: number;
  };
}

const channelIcons = {
  web: MessageSquare,
  whatsapp: SiWhatsapp,
  api: Zap,
};

const priorityColors = {
  low: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  medium: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  high: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  urgent: 'bg-red-500/10 text-red-500 border-red-500/20',
};

const sentimentColors = {
  positive: 'text-green-500',
  neutral: 'text-gray-500',
  negative: 'text-red-500',
};

const slaColors = {
  on_track: 'bg-green-500/10 text-green-500',
  at_risk: 'bg-yellow-500/10 text-yellow-500',
  breached: 'bg-red-500/10 text-red-500',
};

function formatWaitTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function ConversationSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="h-4 w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-5 w-14" />
          </div>
        </div>
      </div>
    </Card>
  );
}

function ConversationCard({ 
  conversation, 
  isSelected, 
  onClick 
}: { 
  conversation: PendingConversation; 
  isSelected: boolean;
  onClick: () => void;
}) {
  const ChannelIcon = channelIcons[conversation.channel];
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      <Card 
        className={`cursor-pointer transition-all hover-elevate ${
          isSelected ? 'ring-2 ring-primary' : ''
        } ${conversation.priority === 'urgent' ? 'border-red-500/50' : ''}`}
        onClick={onClick}
        data-testid={`card-conversation-${conversation.id}`}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="relative">
              <Avatar>
                <AvatarImage src={conversation.customerAvatar} />
                <AvatarFallback>
                  {conversation.customerName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className={`absolute -bottom-1 -right-1 p-0.5 rounded-full bg-background`}>
                <ChannelIcon className="h-3 w-3 text-muted-foreground" />
              </div>
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-medium truncate" data-testid={`text-customer-${conversation.id}`}>
                  {conversation.customerName}
                </span>
                <div className="flex items-center gap-1">
                  {conversation.priority === 'urgent' && (
                    <AlertTriangle className="h-4 w-4 text-red-500 animate-pulse" />
                  )}
                  <Badge 
                    variant="outline" 
                    className={priorityColors[conversation.priority]}
                  >
                    {conversation.priority === 'urgent' ? 'Urgente' : 
                     conversation.priority === 'high' ? 'Alta' :
                     conversation.priority === 'medium' ? 'Média' : 'Baixa'}
                  </Badge>
                </div>
              </div>
              
              <p className="text-sm text-muted-foreground line-clamp-1 mb-2">
                {conversation.lastMessage}
              </p>
              
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className={slaColors[conversation.slaStatus]}>
                  {conversation.slaStatus === 'on_track' ? 'No Prazo' :
                   conversation.slaStatus === 'at_risk' ? 'Em Risco' : 'Violado'}
                </Badge>
                
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>{formatWaitTime(conversation.waitTime)}</span>
                </div>
                
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MessageCircle className="h-3 w-3" />
                  <span>{conversation.messageCount}</span>
                </div>
                
                <div className={`flex items-center gap-1 text-xs ${sentimentColors[conversation.sentiment]}`}>
                  {conversation.sentiment === 'negative' ? (
                    <XCircle className="h-3 w-3" />
                  ) : conversation.sentiment === 'positive' ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : null}
                </div>
                
                {conversation.aiConfidence < 70 && (
                  <Badge variant="outline" className="text-xs">
                    IA: {conversation.aiConfidence}%
                  </Badge>
                )}
              </div>
              
              {conversation.escalationReason && (
                <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                  {conversation.escalationReason}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ConversationDetailPanel({ 
  conversation, 
  onTakeover,
  onHandback,
  isTakingOver,
}: { 
  conversation: ConversationDetail | null;
  onTakeover: (id: string) => void;
  onHandback: (id: string) => void;
  isTakingOver: boolean;
}) {
  const [replyText, setReplyText] = useState('');
  const { user } = useAuth();
  
  const { t } = useTranslation();
  
  const sendMessageMutation = useMutation({
    mutationFn: async ({ conversationId, message }: { conversationId: string; message: string }) => {
      const res = await apiRequest('POST', `/api/takeover/conversations/${conversationId}/message`, { 
        content: message,
      });
      return res.json();
    },
    onSuccess: () => {
      setReplyText('');
      queryClient.invalidateQueries({ queryKey: [`/api/chat/conversations/${conversation?.id}/messages`] });
      queryClient.invalidateQueries({ queryKey: ['/api/takeover/conversations'] });
      toast({ title: t('takeover.success.messageSent') });
    },
    onError: () => {
      toast({ title: t('takeover.errors.sendMessage'), variant: 'destructive' });
    },
  });
  
  const handleSend = () => {
    if (!replyText.trim() || !conversation) return;
    sendMessageMutation.mutate({ 
      conversationId: conversation.id, 
      message: replyText.trim() 
    });
  };

  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6">
        <Headphones className="h-12 w-12 mb-4 opacity-50" />
        <h3 className="font-medium mb-1">Selecione uma conversa</h3>
        <p className="text-sm text-center">
          Escolha uma conversa da lista para ver detalhes e assumir o atendimento
        </p>
      </div>
    );
  }
  
  const isAssignedToMe = conversation.assignedTo === user?.id;
  const canRespond = conversation.status === 'in_progress' && isAssignedToMe;
  
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarImage src={conversation.customerAvatar} />
              <AvatarFallback>
                {conversation.customerName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className="font-semibold">{conversation.customerName}</h3>
              <p className="text-sm text-muted-foreground">
                {conversation.channel === 'whatsapp' ? 'WhatsApp' : 
                 conversation.channel === 'web' ? 'Chat Web' : 'API'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {conversation.status === 'pending' && (
              <Button 
                onClick={() => onTakeover(conversation.id)}
                disabled={isTakingOver}
                data-testid="button-takeover"
              >
                <ArrowLeftRight className="mr-2 h-4 w-4" />
                Assumir
              </Button>
            )}
            {isAssignedToMe && conversation.status === 'in_progress' && (
              <Button 
                variant="outline"
                onClick={() => onHandback(conversation.id)}
                data-testid="button-handback"
              >
                <Bot className="mr-2 h-4 w-4" />
                Devolver para IA
              </Button>
            )}
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className={priorityColors[conversation.priority]}>
            {conversation.priority === 'urgent' ? 'Urgente' : 
             conversation.priority === 'high' ? 'Alta' :
             conversation.priority === 'medium' ? 'Média' : 'Baixa'}
          </Badge>
          <Badge variant="outline" className={slaColors[conversation.slaStatus]}>
            SLA: {conversation.slaStatus === 'on_track' ? 'No Prazo' :
                  conversation.slaStatus === 'at_risk' ? 'Em Risco' : 'Violado'}
          </Badge>
          <Badge variant="secondary">
            <Timer className="mr-1 h-3 w-3" />
            {formatWaitTime(conversation.waitTime)}
          </Badge>
        </div>
        
        {conversation.escalationReason && (
          <div className="mt-3 p-2 rounded-md bg-yellow-500/10 border border-yellow-500/20">
            <p className="text-sm text-yellow-600 dark:text-yellow-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {conversation.escalationReason}
            </p>
          </div>
        )}
      </div>
      
      <Tabs defaultValue="messages" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 mt-2">
          <TabsTrigger value="messages">Mensagens</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>
        
        <TabsContent value="messages" className="flex-1 flex flex-col min-h-0 mt-0">
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {conversation.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.role === 'user' ? '' : 'flex-row-reverse'}`}
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>
                      {msg.role === 'user' ? (
                        <User className="h-4 w-4" />
                      ) : msg.role === 'assistant' ? (
                        <Bot className="h-4 w-4" />
                      ) : (
                        <UserCheck className="h-4 w-4" />
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div className={`max-w-[70%] ${msg.role === 'user' ? '' : 'text-right'}`}>
                    <div
                      className={`inline-block p-3 rounded-lg ${
                        msg.role === 'user'
                          ? 'bg-muted'
                          : msg.role === 'assistant'
                          ? 'bg-primary/10 text-primary-foreground'
                          : 'bg-green-500/10'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(msg.timestamp), { 
                        addSuffix: true, 
                        locale: ptBR 
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          
          {canRespond && (
            <div className="p-4 border-t">
              <div className="flex gap-2">
                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Digite sua resposta..."
                  className="resize-none"
                  rows={2}
                  data-testid="input-reply"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <Button 
                  onClick={handleSend}
                  disabled={!replyText.trim() || sendMessageMutation.isPending}
                  data-testid="button-send-reply"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          
          {!canRespond && conversation.status === 'pending' && (
            <div className="p-4 border-t bg-muted/50">
              <p className="text-sm text-muted-foreground text-center">
                Clique em "Assumir" para responder esta conversa
              </p>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="history" className="flex-1 p-4 mt-0">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Resumo do Cliente</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total de Conversas</span>
                  <span className="font-medium">{conversation.customerHistory.totalConversations}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Resolvidas por IA</span>
                  <span className="font-medium">{conversation.customerHistory.resolvedByAI}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Satisfação Média</span>
                  <span className="font-medium">{conversation.customerHistory.avgSatisfaction}/5</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function TakeoverPanel() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  
  interface APIConversation {
    id: string;
    titulo: string;
    userId: string;
    canal: string;
    status: string;
    assignedAgentId?: string;
    confidenceScore?: number;
    sentimentScore?: number;
    fallbackCount?: number;
    slaDeadline?: string;
    slaBreached?: boolean;
    slaStatus: 'ok' | 'at_risk' | 'breached';
    priority: 'high' | 'medium' | 'low';
    pendingSince?: string;
    ultimaMensagemEm?: string;
    totalMensagens?: number;
    lastMessage?: {
      conteudo: string;
      isFromUser: boolean;
      criadoEm: string;
    };
    user?: {
      id: string;
      email: string;
      firstName?: string;
      lastName?: string;
    };
  }
  
  interface APIResponse {
    conversations: APIConversation[];
    total: number;
    summary: {
      pending: number;
      human: number;
      bot: number;
      slaBreached: number;
      atRisk: number;
    };
  }

  const getBackendStatus = (frontendStatus: string): string => {
    if (frontendStatus === 'pending') return 'pending_handoff';
    if (frontendStatus === 'in_progress') return 'human';
    if (frontendStatus === 'resolved') return 'bot';
    return frontendStatus;
  };
  
  const buildQueryParams = () => {
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.set('status', getBackendStatus(filterStatus));
    if (filterChannel !== 'all') params.set('channel', filterChannel);
    if (filterPriority !== 'all') params.set('priority', filterPriority);
    return params.toString();
  };
  
  const fetchTakeoverConversations = async (): Promise<APIResponse> => {
    const queryString = buildQueryParams();
    const url = `/api/takeover/conversations${queryString ? `?${queryString}` : ''}`;
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Falha ao carregar conversas');
    }
    return response.json();
  };
  
  const { data: apiResponse, isLoading, refetch } = useQuery<APIResponse>({
    queryKey: ['/api/takeover/conversations', filterStatus, filterChannel, filterPriority],
    queryFn: fetchTakeoverConversations,
    refetchInterval: 10000,
    enabled: !!user,
  });
  
  const conversations: PendingConversation[] = (apiResponse?.conversations || []).map((conv): PendingConversation => {
    let waitTimeSeconds = 0;
    if (conv.pendingSince) {
      waitTimeSeconds = Math.floor((Date.now() - new Date(conv.pendingSince).getTime()) / 1000);
    } else if (conv.ultimaMensagemEm) {
      waitTimeSeconds = Math.floor((Date.now() - new Date(conv.ultimaMensagemEm).getTime()) / 1000);
    }
    
    let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral';
    if (conv.sentimentScore !== undefined) {
      if (conv.sentimentScore > 0.3) sentiment = 'positive';
      else if (conv.sentimentScore < -0.3) sentiment = 'negative';
    }
    
    let slaStatus: 'on_track' | 'at_risk' | 'breached' = 'on_track';
    if (conv.slaStatus === 'breached') slaStatus = 'breached';
    else if (conv.slaStatus === 'at_risk') slaStatus = 'at_risk';
    
    let mappedStatus: 'pending' | 'in_progress' | 'resolved' = 'pending';
    if (conv.status === 'human') mappedStatus = 'in_progress';
    else if (conv.status === 'pending_handoff') mappedStatus = 'pending';
    else if (conv.status === 'bot') mappedStatus = 'resolved';
    
    return {
      id: conv.id,
      customerId: conv.userId || 'unknown',
      customerName: conv.user 
        ? `${conv.user.firstName || ''} ${conv.user.lastName || ''}`.trim() || conv.user.email
        : 'Cliente',
      channel: (conv.canal as 'web' | 'whatsapp' | 'api') || 'web',
      status: mappedStatus,
      priority: conv.priority === 'high' ? 'high' : conv.priority === 'medium' ? 'medium' : 'low',
      waitTime: waitTimeSeconds,
      sentiment,
      lastMessage: conv.lastMessage?.conteudo || conv.titulo || 'Sem mensagens',
      messageCount: conv.totalMensagens || 0,
      aiConfidence: (conv.confidenceScore || 0.5) * 100,
      escalationReason: conv.fallbackCount && conv.fallbackCount >= 3 ? 'Múltiplas falhas de IA' : undefined,
      assignedTo: conv.assignedAgentId,
      slaStatus,
      createdAt: conv.pendingSince || conv.ultimaMensagemEm || new Date().toISOString(),
    };
  });
  
  interface MessagesResponse {
    messages: Array<{ 
      id: string; 
      conteudo: string; 
      isFromUser: boolean; 
      criadoEm: string;
      userId?: string;
    }>;
  }
  
  const { data: messagesData } = useQuery<MessagesResponse>({
    queryKey: [`/api/chat/conversations/${selectedId}/messages`],
    enabled: !!selectedId,
  });
  
  const selectedConversation: ConversationDetail | undefined = (() => {
    const conv = conversations.find(c => c.id === selectedId);
    if (!conv) return undefined;
    return {
      ...conv,
      messages: (messagesData?.messages || []).map(m => ({
        id: m.id,
        role: m.isFromUser ? 'user' as const : 'assistant' as const,
        content: m.conteudo,
        timestamp: m.criadoEm,
      })),
      customerHistory: {
        totalConversations: 1,
        resolvedByAI: 0,
        avgSatisfaction: 4,
      },
    };
  })();
  
  const takeoverMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await apiRequest('POST', `/api/chat/conversations/${conversationId}/takeover`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/takeover/conversations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chat/conversations', selectedId] });
      toast({ title: t('takeover.success.conversationTaken') });
    },
    onError: () => {
      toast({ title: t('takeover.errors.takeConversation'), variant: 'destructive' });
    },
  });
  
  const handbackMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await apiRequest('POST', `/api/chat/conversations/${conversationId}/handback`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/takeover/conversations'] });
      queryClient.invalidateQueries({ queryKey: [`/api/chat/conversations/${selectedId}/messages`] });
      toast({ title: t('takeover.success.conversationReturned') });
    },
    onError: () => {
      toast({ title: t('takeover.errors.returnConversation'), variant: 'destructive' });
    },
  });
  
  const filteredConversations = (conversations || []).filter((conv) => {
    if (filterChannel !== 'all' && conv.channel !== filterChannel) return false;
    if (filterPriority !== 'all' && conv.priority !== filterPriority) return false;
    if (filterStatus !== 'all' && conv.status !== filterStatus) return false;
    if (searchQuery && !conv.customerName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });
  
  const urgentCount = (conversations || []).filter(c => c.priority === 'urgent').length;
  const pendingCount = (conversations || []).filter(c => c.status === 'pending').length;
  const inProgressCount = (conversations || []).filter(c => c.status === 'in_progress').length;
  
  return (
    <div className="flex h-full">
      <div className="w-[400px] border-r flex flex-col">
        <div className="p-4 border-b space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold" data-testid="text-page-title">
                {t('takeover.title')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {pendingCount} {t('integrations.pending')}, {inProgressCount} {t('agents.statuses.in_progress')}
              </p>
            </div>
            <Button variant="outline" size="icon" onClick={() => refetch()} data-testid="button-refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          
          {urgentCount > 0 && (
            <div className="p-2 rounded-md bg-red-500/10 border border-red-500/20 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-sm text-red-600 dark:text-red-400">
                {urgentCount} conversa{urgentCount > 1 ? 's' : ''} urgente{urgentCount > 1 ? 's' : ''}
              </span>
            </div>
          )}
          
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cliente..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
                data-testid="input-search"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[120px]" data-testid="select-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Pendentes</SelectItem>
                <SelectItem value="in_progress">Em Progresso</SelectItem>
                <SelectItem value="resolved">Resolvidas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex gap-2">
            <Select value={filterChannel} onValueChange={setFilterChannel}>
              <SelectTrigger className="flex-1" data-testid="select-channel">
                <SelectValue placeholder="Canal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Canais</SelectItem>
                <SelectItem value="web">Chat Web</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="api">API</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="flex-1" data-testid="select-priority">
                <SelectValue placeholder="Prioridade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="urgent">Urgente</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="medium">Média</SelectItem>
                <SelectItem value="low">Baixa</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-3">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <ConversationSkeleton key={i} />
              ))
            ) : filteredConversations.length > 0 ? (
              <AnimatePresence>
                {filteredConversations.map((conv) => (
                  <ConversationCard
                    key={conv.id}
                    conversation={conv}
                    isSelected={selectedId === conv.id}
                    onClick={() => setSelectedId(conv.id)}
                  />
                ))}
              </AnimatePresence>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mb-4 opacity-50" />
                <h3 className="font-medium mb-1">Nenhuma conversa pendente</h3>
                <p className="text-sm text-center">
                  Todas as conversas estão sendo atendidas pela IA
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
      
      <div className="flex-1">
        <ConversationDetailPanel
          conversation={selectedConversation || null}
          onTakeover={(id) => takeoverMutation.mutate(id)}
          onHandback={(id) => handbackMutation.mutate(id)}
          isTakingOver={takeoverMutation.isPending}
        />
      </div>
    </div>
  );
}
