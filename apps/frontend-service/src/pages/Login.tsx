import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Loader2, Mail, Chrome, Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { LanguageSwitch } from '@/components/language-switch';
import { ThemeToggle } from '@/components/theme-toggle';

interface AuthProvider {
  id: string;
  name: string;
  enabled: boolean;
}

export default function Login() {
  const { t } = useTranslation();
  const { login, isLoginPending } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);

  useEffect(() => {
    fetch('/api/auth/providers')
      .then(res => res.json())
      .then(data => {
        setProviders(data.providers || []);
        setIsLoadingProviders(false);
      })
      .catch(() => {
        setIsLoadingProviders(false);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login({ email, password });
    } catch (error) {
      toast({
        title: t('auth.loginError'),
        description: error instanceof Error ? error.message : t('auth.invalidCredentials'),
        variant: 'destructive',
      });
    }
  };

  const handleOAuthLogin = (provider: string) => {
    window.location.href = `/api/auth/${provider}`;
  };

  const getProviderIcon = (id: string) => {
    switch (id) {
      case 'google':
        return <Chrome className="h-5 w-5" />;
      case 'github':
        return <Github className="h-5 w-5" />;
      case 'microsoft':
        return (
          <svg className="h-5 w-5" viewBox="0 0 23 23" fill="currentColor">
            <path d="M11 11H0V0h11v11zm12 0H12V0h11v11zM11 23H0V12h11v11zm12 0H12V12h11v11z" />
          </svg>
        );
      default:
        return <Mail className="h-5 w-5" />;
    }
  };

  const oauthProviders = providers.filter(p => p.id !== 'local');
  const hasLocalAuth = providers.some(p => p.id === 'local');

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <LanguageSwitch />
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Bot className="h-7 w-7" />
            </div>
          </div>
          <CardTitle className="text-2xl" data-testid="text-login-title">
            {t('auth.title')}
          </CardTitle>
          <CardDescription data-testid="text-login-description">
            {t('auth.subtitle')}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {isLoadingProviders ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {oauthProviders.length > 0 && (
                <div className="space-y-2">
                  {oauthProviders.map((provider) => (
                    <Button
                      key={provider.id}
                      variant="outline"
                      className="w-full"
                      onClick={() => handleOAuthLogin(provider.id)}
                      data-testid={`button-login-${provider.id}`}
                    >
                      {getProviderIcon(provider.id)}
                      <span className="ml-2">
                        {t('auth.continueWith', { provider: provider.name })}
                      </span>
                    </Button>
                  ))}
                </div>
              )}

              {oauthProviders.length > 0 && hasLocalAuth && (
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <Separator className="w-full" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      {t('auth.or')}
                    </span>
                  </div>
                </div>
              )}

              {hasLocalAuth && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">{t('auth.email')}</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      required
                      data-testid="input-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">{t('auth.password')}</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      data-testid="input-password"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoginPending}
                    data-testid="button-login"
                  >
                    {isLoginPending && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    {t('auth.login')}
                  </Button>
                </form>
              )}
            </>
          )}

          <p className="text-center text-xs text-muted-foreground">
            {t('auth.termsNotice')}{' '}
            <a href="#" className="underline hover:text-foreground">
              {t('auth.termsOfService')}
            </a>
            {' '}{t('auth.and')}{' '}
            <a href="#" className="underline hover:text-foreground">
              {t('auth.privacyPolicy')}
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
