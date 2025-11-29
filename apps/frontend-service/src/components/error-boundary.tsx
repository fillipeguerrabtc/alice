import { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { frontendLogger } from '@/lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // REGRA 8: Logger estruturado ao invés de console.error
    frontendLogger.error('ErrorBoundary capturou erro no componente React', {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      componentStack: errorInfo.componentStack,
      url: window.location.href,
      userAgent: navigator.userAgent,
    });
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-screen items-center justify-center bg-background p-4">
          <Card className="max-w-lg w-full">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <AlertTriangle className="h-12 w-12 text-destructive" />
              </div>
              <CardTitle className="text-xl">Algo deu errado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                Ocorreu um erro inesperado. Por favor, tente recarregar a página.
              </p>
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <div className="bg-muted p-3 rounded-md overflow-auto max-h-40">
                  <pre className="text-xs text-destructive whitespace-pre-wrap">
                    {this.state.error.message}
                    {this.state.errorInfo?.componentStack}
                  </pre>
                </div>
              )}
              <div className="flex gap-2 justify-center">
                <Button
                  variant="outline"
                  onClick={this.handleReset}
                  data-testid="button-error-retry"
                >
                  Tentar novamente
                </Button>
                <Button
                  onClick={this.handleReload}
                  data-testid="button-error-reload"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Recarregar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
