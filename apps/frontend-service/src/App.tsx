import { Switch, Route } from 'wouter';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitch } from '@/components/language-switch';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { useAuth } from '@/hooks/use-auth';

import Dashboard from '@/pages/Dashboard';
import Chat from '@/pages/Chat';
import Documents from '@/pages/Documents';
import Training from '@/pages/Training';
import Integrations from '@/pages/Integrations';
import Settings from '@/pages/Settings';
import Login from '@/pages/Login';
import Landing from '@/pages/Landing';
import Agents from '@/pages/Agents';
import Namespaces from '@/pages/Namespaces';
import WisePayments from '@/pages/WisePayments';
import TakeoverPanel from '@/pages/TakeoverPanel';
import NotFound from '@/pages/NotFound';

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
      <Route path="/namespaces" component={Namespaces} />
      <Route path="/documents" component={Documents} />
      <Route path="/training" component={Training} />
      <Route path="/integrations" component={Integrations} />
      <Route path="/wise" component={WisePayments} />
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
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-xl animate-pulse">
            A
          </div>
          <p className="text-muted-foreground text-sm">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route component={Landing} />
      </Switch>
    );
  }

  return (
    <AuthenticatedLayout>
      <Router />
    </AuthenticatedLayout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AppContent />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
