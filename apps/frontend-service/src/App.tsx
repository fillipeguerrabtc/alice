import { Switch, Route } from 'wouter';
import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { queryClient } from '@/lib/queryClient';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitch } from '@/components/language-switch';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { ErrorBoundary } from '@/components/error-boundary';
import { useAuth } from '@/hooks/use-auth';
import { Loader2 } from 'lucide-react';

// PERFORMANCE: Lazy loading de páginas (React 18+ Best Practices 2025)
// Reduz bundle inicial e carrega páginas sob demanda
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Chat = lazy(() => import('@/pages/Chat'));
const Documents = lazy(() => import('@/pages/Documents'));
const Training = lazy(() => import('@/pages/Training'));
const Integrations = lazy(() => import('@/pages/Integrations'));
const Settings = lazy(() => import('@/pages/Settings'));
const Login = lazy(() => import('@/pages/Login'));
const Landing = lazy(() => import('@/pages/Landing'));
const Agents = lazy(() => import('@/pages/Agents'));
const Namespaces = lazy(() => import('@/pages/Namespaces'));
const WisePayments = lazy(() => import('@/pages/WisePayments'));
const TakeoverPanel = lazy(() => import('@/pages/TakeoverPanel'));
const ImageGalleryPage = lazy(() => import('@/pages/ImageGalleryPage'));
const ModulesAdmin = lazy(() => import('@/pages/ModulesAdmin'));
const NotFound = lazy(() => import('@/pages/NotFound'));

// Loading spinner para Suspense fallback
function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center" data-testid="loader-page">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const sidebarStyle = {
    '--sidebar-width': '16rem',
    '--sidebar-width-icon': '3rem',
  } as React.CSSProperties;

  return (
    <SidebarProvider style={sidebarStyle}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 p-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <LanguageSwitch />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/chat" component={Chat} />
      <Route path="/chat/:conversationId" component={Chat} />
      <Route path="/agents" component={Agents} />
      <Route path="/takeover" component={TakeoverPanel} />
      <Route path="/images" component={ImageGalleryPage} />
      <Route path="/namespaces" component={Namespaces} />
      <Route path="/documents" component={Documents} />
      <Route path="/training" component={Training} />
      <Route path="/integrations" component={Integrations} />
      <Route path="/wise" component={WisePayments} />
      <Route path="/modules" component={ModulesAdmin} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <img
            src="/logo-round.png"
            alt="Yes You Deserve"
            className="h-12 w-12 rounded-xl animate-pulse"
            data-testid="img-loading-logo"
          />
          <p className="text-muted-foreground text-sm">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/login" component={Login} />
          <Route component={Landing} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <AuthenticatedLayout>
      <Suspense fallback={<PageLoader />}>
        <Router />
      </Suspense>
    </AuthenticatedLayout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <AppContent />
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
