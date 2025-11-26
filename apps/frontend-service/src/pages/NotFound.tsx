import { Link } from 'wouter';
import { Home, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      <h1 className="text-6xl font-bold text-muted-foreground mb-4">404</h1>
      <h2 className="text-2xl font-semibold mb-2">Página não encontrada</h2>
      <p className="text-muted-foreground mb-6 max-w-md">
        A página que você está procurando não existe ou foi movida.
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => window.history.back()} data-testid="button-go-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar
        </Button>
        <Button asChild data-testid="button-go-home">
          <Link href="/">
            <Home className="h-4 w-4 mr-2" />
            Página Inicial
          </Link>
        </Button>
      </div>
    </div>
  );
}
