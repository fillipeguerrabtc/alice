import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Mail, Chrome, Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { LanguageSwitch } from '@/components/language-switch';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Obtém a URL de retorno após login bem-sucedido.
 * Verifica o query param `returnTo` e valida se é uma URL segura (interna).
 * 
 * Regra 6 CLAUDE.md: Sem workarounds - validação enterprise de URLs
 * Regra 16 CLAUDE.md: Segurança - previne open redirect attacks
 * 
 * NOTA: Esta função é usada apenas para OAuth redirect neste componente.
 * Uma cópia idêntica existe em App.tsx para o LoginRedirect (evita import circular).
 */
function getReturnUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get('returnTo');
  
  // Se não há returnTo, retornar para Dashboard
  if (!returnTo) {
    return '/';
  }
  
  // Validação de segurança: só aceitar URLs internas (começam com /)
  // Previne open redirect attacks (ex: returnTo=https://evil.com)
  if (!returnTo.startsWith('/') || returnTo.startsWith('//')) {
    return '/';
  }
  
  // Não redirecionar para a própria página de login (evita loop)
  if (returnTo.startsWith('/login')) {
    return '/';
  }
  
  return returnTo;
}

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

  /**
   * Handler de submit do formulário de login.
   * 
   * IMPORTANTE: Não navegamos aqui após login bem-sucedido!
   * O redirecionamento é feito automaticamente pelo Router em App.tsx
   * quando isAuthenticated se torna true após o refetch da query de auth.
   * 
   * Isso evita race condition onde navigate() é chamado antes do
   * estado de auth ser atualizado, causando redirect loop.
   * 
   * Fluxo correto:
   * 1. login() completa com sucesso
   * 2. onSuccess invalida query de auth → refetch automático
   * 3. isAuthenticated se torna true
   * 4. AppContent re-renderiza e mostra Router (usuário autenticado)
   * 5. Router rota /login redireciona para returnTo ou /
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login({ email, password });
      // Navegação é tratada pelo Router quando isAuthenticated=true
      // Ver App.tsx: Router rota /login com LoginRedirect
    } catch (error) {
      toast({
        title: t('auth.loginError'),
        description: error instanceof Error ? error.message : t('auth.invalidCredentials'),
        variant: 'destructive',
      });
    }
  };

  const handleOAuthLogin = (provider: string) => {
    // Para OAuth, passar returnTo como state para o backend processar
    // O backend deve redirecionar de volta para a URL pretendida após autenticação OAuth
    const returnUrl = getReturnUrl();
    const oauthUrl = returnUrl !== '/' 
      ? `/api/auth/${provider}?returnTo=${encodeURIComponent(returnUrl)}`
      : `/api/auth/${provider}`;
    window.location.href = oauthUrl;
  };

  const getProviderIcon = (id: string) => {
    switch (id) {
      case 'google':
        return <Chrome className="h-5 w-5" />;
      case 'github':
        return <Github className="h-5 w-5" />;
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
            <img
              src="/logo-round.png"
              alt="Yes You Deserve"
              className="h-12 w-12 rounded-xl"
              data-testid="img-login-logo"
            />
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
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
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
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
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
