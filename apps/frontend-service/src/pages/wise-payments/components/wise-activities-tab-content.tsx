import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TabsContent } from '@/components/ui/tabs';

type WiseActivityFilters = {
  monetaryResourceType: string;
  profileId: string;
  since: string;
  size: string;
  status: string;
  until: string;
};

type WiseActivitiesTabContentProps = {
  activityFilters: WiseActivityFilters;
  activityResults: string | null;
  onActivityFilterChange: (field: keyof WiseActivityFilters, value: string) => void;
  onListActivities: () => void;
  t: TFunction;
};

export function WiseActivitiesTabContent({
  activityFilters,
  activityResults,
  onActivityFilterChange,
  onListActivities,
  t,
}: WiseActivitiesTabContentProps) {
  return (
    <TabsContent value="activities" className="space-y-4 mt-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('wise.activities.title')}</CardTitle>
          <CardDescription>{t('wise.activities.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('wise.activities.profileId')}</Label>
              <Input
                value={activityFilters.profileId}
                onChange={(event) => onActivityFilterChange('profileId', event.target.value)}
                placeholder={t('wise.activities.profilePlaceholder')}
                data-testid="input-activity-profile"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('wise.activities.status')}</Label>
              <Input
                value={activityFilters.status}
                onChange={(event) => onActivityFilterChange('status', event.target.value)}
                placeholder={t('wise.activities.statusPlaceholder')}
                data-testid="input-activity-status"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('wise.activities.resourceType')}</Label>
              <Input
                value={activityFilters.monetaryResourceType}
                onChange={(event) => onActivityFilterChange('monetaryResourceType', event.target.value)}
                placeholder={t('wise.activities.resourcePlaceholder')}
                data-testid="input-activity-resource"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('wise.activities.size')}</Label>
              <Input
                value={activityFilters.size}
                onChange={(event) => onActivityFilterChange('size', event.target.value)}
                placeholder={t('wise.activities.sizePlaceholder')}
                data-testid="input-activity-size"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('wise.activities.since')}</Label>
              <Input
                type="datetime-local"
                value={activityFilters.since}
                onChange={(event) => onActivityFilterChange('since', event.target.value)}
                data-testid="input-activity-since"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('wise.activities.until')}</Label>
              <Input
                type="datetime-local"
                value={activityFilters.until}
                onChange={(event) => onActivityFilterChange('until', event.target.value)}
                data-testid="input-activity-until"
              />
            </div>
          </div>
          <Button onClick={onListActivities} data-testid="button-fetch-activities">
            {t('wise.activities.fetch')}
          </Button>
          {activityResults && (
            <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
              {activityResults}
            </pre>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}
