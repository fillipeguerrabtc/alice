import { Link } from 'wouter';
import { Home, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

export default function NotFound() {
  const { t } = useTranslation();
  
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      <h1 className="text-6xl font-bold text-muted-foreground mb-4">404</h1>
      <h2 className="text-2xl font-semibold mb-2">{t('notFound.title')}</h2>
      <p className="text-muted-foreground mb-6 max-w-md">
        {t('notFound.message')}
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => window.history.back()} data-testid="button-go-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('notFound.goBack')}
        </Button>
        <Button asChild data-testid="button-go-home">
          <Link href="/">
            <Home className="h-4 w-4 mr-2" />
            {t('notFound.goHome')}
          </Link>
        </Button>
      </div>
    </div>
  );
}
