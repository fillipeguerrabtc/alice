import { Switch, Route, Redirect, useLocation } from 'wouter';
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
const Agents = lazy(() => import('@/pages/Agents'));
const Namespaces = lazy(() => import('@/pages/Namespaces'));
const WisePayments = lazy(() => import('@/pages/WisePayments'));
const Trading = lazy(() => import('@/pages/Trading'));
const TakeoverPanel = lazy(() => import('@/pages/TakeoverPanel'));
const ImageGalleryPage = lazy(() => import('@/pages/ImageGalleryPage'));
const ModulesAdmin = lazy(() => import('@/pages/ModulesAdmin'));
const Observability = lazy(() => import('@/pages/Observability'));
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
      {/* Redireciona /login para / quando autenticado (pós-OIDC callback) */}
      {/* CORREÇÃO PR#107: Usar Redirect do wouter ao invés de window.location.href */}
      {/* - Evita side effect durante render (React rules) */}
      {/* - Navegação client-side sem reload (melhor UX) */}
      <Route path="/login">{() => <Redirect to="/" />}</Route>
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
      <Route path="/trading" component={Trading} />
      <Route path="/modules" component={ModulesAdmin} />
      <Route path="/observability" component={Observability} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

/**
 * Componente que redireciona usuários não autenticados para a página de login.
 * Preserva a URL pretendida no query param `returnTo` para redirecionamento pós-login.
 * 
 * Fluxo:
 * 1. Usuário não autenticado acessa /trading → redirecionado para /login?returnTo=/trading
 * 2. Após login bem-sucedido → redirecionado para /trading
 * 
 * Regra 6 CLAUDE.md: Sem workarounds - implementação enterprise com persistência real
 */
function RedirectToLogin() {
  const [location] = useLocation();
  
  // Não incluir returnTo se já estiver na página de login (evita loop)
  // Também não incluir returnTo=/ pois Dashboard é o destino padrão
  const shouldIncludeReturnTo = location !== '/login' && location !== '/';
  const loginUrl = shouldIncludeReturnTo 
    ? `/login?returnTo=${encodeURIComponent(location)}`
    : '/login';
  
  return <Redirect to={loginUrl} />;
}

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <img
            src="/logo-round.png"
            alt="Alice"
            className="h-12 w-12 rounded-xl animate-pulse"
            data-testid="img-loading-logo"
          />
          <p className="text-muted-foreground text-sm">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Usuário não autenticado: mostrar Login ou redirecionar para Login
    // Se já está em /login, mostrar a página de Login
    // Se está em outra página, redirecionar para Login com returnTo
    if (location.startsWith('/login')) {
      return (
        <Suspense fallback={<PageLoader />}>
          <Login />
        </Suspense>
      );
    }
    
    // Redirecionar para Login preservando a URL pretendida
    return <RedirectToLogin />;
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
