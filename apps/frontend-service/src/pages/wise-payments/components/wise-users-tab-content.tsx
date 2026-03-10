import type { TFunction } from 'i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { TabsContent } from '@/components/ui/tabs';

type WiseUsersTabContentProps = {
  isLoadingWiseUserMe: boolean;
  onFetchWiseUser: () => void;
  onRefreshWiseUserMe: () => void;
  setWiseUserId: (value: string) => void;
  t: TFunction;
  wiseUserId: string;
  wiseUserMeDataUser: Record<string, unknown> | null;
  wiseUserResult: string | null;
};

export function WiseUsersTabContent({
  isLoadingWiseUserMe,
  onFetchWiseUser,
  onRefreshWiseUserMe,
  setWiseUserId,
  t,
  wiseUserId,
  wiseUserMeDataUser,
  wiseUserResult,
}: WiseUsersTabContentProps) {
  return (
    <TabsContent value="users" className="space-y-4 mt-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('wise.users.title')}</CardTitle>
          <CardDescription>{t('wise.users.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">{t('wise.users.me')}</span>
            <Button variant="outline" size="sm" onClick={onRefreshWiseUserMe} data-testid="button-refresh-users-me">
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('common.refresh')}
            </Button>
          </div>
          {isLoadingWiseUserMe ? (
            <Skeleton className="h-40" />
          ) : wiseUserMeDataUser ? (
            <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
              {JSON.stringify(wiseUserMeDataUser, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">{t('wise.users.noData')}</p>
          )}
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label>{t('wise.users.byId')}</Label>
              <Input
                value={wiseUserId}
                onChange={(event) => setWiseUserId(event.target.value)}
                placeholder={t('wise.users.idPlaceholder')}
                data-testid="input-user-id"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={onFetchWiseUser} data-testid="button-fetch-user">
                {t('wise.users.fetch')}
              </Button>
            </div>
          </div>
          {wiseUserResult && (
            <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
              {wiseUserResult}
            </pre>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}
