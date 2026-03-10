import type { TFunction } from 'i18next';
import { CheckCircle, FileCheck, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/utils';

type TradingPostMortemItem = {
  confidenceScore?: number | null;
  criadoEm: string;
  id: string;
  lessons?: string[] | null;
  marketType?: 'futures' | 'spot' | 'margin' | null;
  motivators?: string[] | null;
  qualityScore?: number | null;
  recommendation?: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  summary?: string | null;
  symbol?: string | null;
};

type TradingPostMortemsTabContentProps = {
  isLoadingPostmortems: boolean;
  locale: string;
  onOpenSendToTraining: (postmortemId: string) => void;
  onRefreshPostmortems: () => void;
  postmortemIdsSentToTraining: Set<string>;
  postmortems: TradingPostMortemItem[];
  sendPostMortemToTrainingPending: boolean;
  t: TFunction;
  timeZone: string;
};

export function TradingPostMortemsTabContent({
  isLoadingPostmortems,
  locale,
  onOpenSendToTraining,
  onRefreshPostmortems,
  postmortemIdsSentToTraining,
  postmortems,
  sendPostMortemToTrainingPending,
  t,
  timeZone,
}: TradingPostMortemsTabContentProps) {
  return (
    <div className="space-y-4 mt-6">
      <div className="flex justify-between items-center">
        <CardDescription>
          Post-mortems das operações reais. O envio para treinamento é permitido somente quando o post-mortem está completo.
        </CardDescription>
        <Button variant="outline" onClick={onRefreshPostmortems}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('common.refresh')}
        </Button>
      </div>

      {isLoadingPostmortems ? (
        <Skeleton className="h-64" />
      ) : postmortems.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileCheck className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Nenhum post-mortem encontrado para operações reais.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {postmortems.map((pm) => {
            const motivators = Array.isArray(pm.motivators) ? pm.motivators : [];
            const lessons = Array.isArray(pm.lessons) ? pm.lessons : [];
            const canSendToTraining = pm.status === 'completed';

            return (
              <Card key={pm.id}>
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline">{pm.symbol ?? 'N/A'}</Badge>
                        <Badge
                          variant={
                            pm.status === 'completed'
                              ? 'default'
                              : pm.status === 'processing'
                                ? 'secondary'
                                : pm.status === 'failed'
                                  ? 'destructive'
                                  : 'outline'
                          }
                        >
                          {pm.status}
                        </Badge>
                        {pm.marketType && <Badge variant="outline">{pm.marketType}</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Criado em {formatDateTime(pm.criadoEm, { locale, timeZone })}
                      </p>
                    </div>
                    <div className="text-right text-sm space-y-1">
                      {typeof pm.confidenceScore === 'number' && (
                        <p>Confiança: {(pm.confidenceScore * 100).toFixed(0)}%</p>
                      )}
                      {typeof pm.qualityScore === 'number' && (
                        <p>Qualidade: {pm.qualityScore.toFixed(2)}</p>
                      )}
                    </div>
                  </div>

                  {(pm.summary || pm.recommendation) && (
                    <div className="space-y-2">
                      {pm.summary && (
                        <>
                          <p className="text-sm font-medium">Resumo</p>
                          <p className="text-sm text-muted-foreground">{pm.summary}</p>
                        </>
                      )}
                      {pm.recommendation && (
                        <>
                          <p className="text-sm font-medium">Recomendação</p>
                          <p className="text-sm text-muted-foreground">{pm.recommendation}</p>
                        </>
                      )}
                    </div>
                  )}

                  {motivators.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2">Motivadores</p>
                      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                        {motivators.map((item, index) => (
                          <li key={`${pm.id}-motivator-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {lessons.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2">Lições Aprendidas</p>
                      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                        {lessons.map((item, index) => (
                          <li key={`${pm.id}-lesson-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="pt-2 border-t flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        !canSendToTraining ||
                        postmortemIdsSentToTraining.has(pm.id) ||
                        sendPostMortemToTrainingPending
                      }
                      onClick={() => onOpenSendToTraining(pm.id)}
                    >
                      {sendPostMortemToTrainingPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Enviando...
                        </>
                      ) : postmortemIdsSentToTraining.has(pm.id) ? (
                        <>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Enviado para Treinamento
                        </>
                      ) : (
                        <>
                          <FileCheck className="h-4 w-4 mr-2" />
                          Enviar para Treinamento
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
