import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/use-auth';
import { apiRequest } from '@/lib/queryClient';
import { SummaryKpisSection } from './sections/SummaryKpisSection';
import { ActionRequiredSection } from './sections/ActionRequiredSection';
import { HealthSummarySection } from './sections/HealthSummarySection';
import { TrendSection } from './sections/TrendSection';
import { RecentActivitySection } from './sections/RecentActivitySection';
import { DomainSnapshotsSection } from './sections/DomainSnapshotsSection';
import type { DashboardHomeResponse } from './types';

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const locale = user?.idioma ?? 'pt-BR';

  const navigateTo = useCallback((href: string) => {
    navigate(href);
  }, [navigate]);

  const { data, isLoading } = useQuery<DashboardHomeResponse>({
    queryKey: ['/api/dashboard/home'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/dashboard/home');
      return response.json();
    },
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
  });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <h1 className="sr-only">Dashboard</h1>

      <SummaryKpisSection
        cards={data?.summaryCards ?? []}
        isLoading={isLoading}
        locale={locale}
        onNavigate={navigateTo}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <ActionRequiredSection
          alerts={data?.alerts ?? []}
          isLoading={isLoading}
          onNavigate={navigateTo}
        />
        <HealthSummarySection
          health={data?.health}
          isLoading={isLoading}
          locale={locale}
          onNavigate={navigateTo}
        />
      </div>

      <TrendSection
        data={data?.trends}
        isLoading={isLoading}
        locale={locale}
      />

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <RecentActivitySection
          items={data?.recentActivity ?? []}
          isLoading={isLoading}
          locale={locale}
          onNavigate={navigateTo}
        />
        <DomainSnapshotsSection
          snapshots={data?.domainSnapshots ?? []}
          isLoading={isLoading}
          onNavigate={navigateTo}
        />
      </div>
    </div>
  );
}
