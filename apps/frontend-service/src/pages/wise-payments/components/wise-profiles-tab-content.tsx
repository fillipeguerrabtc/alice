import type { TFunction } from 'i18next';
import { RefreshCw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TabsContent } from '@/components/ui/tabs';

type WiseProfile = {
  id: number;
  type: string;
  details?: {
    companyName?: string;
    firstName?: string;
    lastName?: string;
  };
};

type WiseProfilesTabContentProps = {
  isLoadingProfiles: boolean;
  onRefreshProfiles: () => void;
  profiles: WiseProfile[];
  t: TFunction;
};

export function WiseProfilesTabContent({
  isLoadingProfiles,
  onRefreshProfiles,
  profiles,
  t,
}: WiseProfilesTabContentProps) {
  return (
    <TabsContent value="profiles" className="space-y-4 mt-6">
      <div className="flex justify-between items-center">
        <CardDescription>{t('wise.profiles.subtitle')}</CardDescription>
        <Button variant="outline" size="sm" onClick={onRefreshProfiles} data-testid="button-refresh-profiles">
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('common.refresh')}
        </Button>
      </div>
      {isLoadingProfiles ? (
        <Skeleton className="h-64" />
      ) : profiles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">{t('wise.profiles.noProfiles')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>{t('wise.profiles.type')}</TableHead>
                <TableHead>{t('wise.profiles.name')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((profile) => (
                <TableRow key={profile.id} data-testid={`row-profile-${profile.id}`}>
                  <TableCell className="font-mono">{profile.id}</TableCell>
                  <TableCell>{profile.type}</TableCell>
                  <TableCell>
                    {profile.details?.companyName ||
                      [profile.details?.firstName, profile.details?.lastName].filter(Boolean).join(' ') ||
                      '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </TabsContent>
  );
}
