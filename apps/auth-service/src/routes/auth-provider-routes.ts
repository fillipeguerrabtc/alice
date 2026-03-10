import type { Express, Request, Response } from 'express';
import type { PassportStatic } from 'passport';

interface RegisterAuthProviderRoutesDeps {
  passport: PassportStatic;
  googleEnabled: boolean;
  githubEnabled: boolean;
  samlEnabled: boolean;
  googleCallbackPath: string;
  githubCallbackPath: string;
}

export function registerAuthProviderRoutes(
  app: Express,
  deps: RegisterAuthProviderRoutesDeps,
): void {
  const {
    passport,
    googleEnabled,
    githubEnabled,
    samlEnabled,
    googleCallbackPath,
    githubCallbackPath,
  } = deps;

  if (googleEnabled) {
    app.get('/api/auth/google', passport.authenticate('google', {
      scope: ['profile', 'email'],
    }));

    const googleCallbackHandler = passport.authenticate('google', {
      failureRedirect: '/login?error=google_auth_failed',
      successRedirect: '/dashboard',
    });

    const googleCallbackPaths = new Set([
      googleCallbackPath,
      '/api/auth/google/callback',
      '/api/auth/google/callback/',
    ]);

    for (const path of googleCallbackPaths) {
      if (!path) continue;
      app.get(path, googleCallbackHandler);
    }
  }

  if (githubEnabled) {
    app.get('/api/auth/github', passport.authenticate('github', {
      scope: ['user:email'],
    }));

    const githubCallbackHandler = passport.authenticate('github', {
      failureRedirect: '/login?error=github_auth_failed',
      successRedirect: '/dashboard',
    });

    const githubCallbackPaths = new Set([
      githubCallbackPath,
      '/api/auth/github/callback',
      '/api/auth/github/callback/',
    ]);

    for (const path of githubCallbackPaths) {
      if (!path) continue;
      app.get(path, githubCallbackHandler);
    }
  }

  if (samlEnabled) {
    app.get('/api/auth/saml', passport.authenticate('saml'));

    app.post('/api/auth/saml/callback',
      passport.authenticate('saml', {
        failureRedirect: '/login?error=saml_auth_failed',
        successRedirect: '/dashboard',
      }),
    );

    app.get('/api/auth/saml/metadata', (_req: Request, res: Response) => {
      const strategy = (passport as { _strategy?: (name: string) => { generateServiceProviderMetadata?: (decryptionCert?: string, signingCert?: string) => string } })._strategy?.('saml');
      if (strategy?.generateServiceProviderMetadata) {
        const metadata = strategy.generateServiceProviderMetadata();
        res.type('application/xml');
        return res.send(metadata);
      }
      return res.status(404).json({ error: 'Estratégia SAML não configurada' });
    });
  }
}
