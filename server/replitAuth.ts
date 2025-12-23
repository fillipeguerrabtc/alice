import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

// BUG FIX 23/12/2025: IdTokenClaims não é exportado do openid-client v6+
// Criar interface local baseada na estrutura esperada do ID token
// Isso garante type safety sem depender de tipos internos não exportados
interface IdTokenClaims {
  sub: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  profile_image_url?: string;
  exp?: number;
  [key: string]: unknown; // Permitir propriedades adicionais do token
}

interface UserSession {
  claims?: IdTokenClaims;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

function updateUserSession(
  user: UserSession,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  // BUG FIX 23/12/2025: Validação defensiva antes de type assertion
  // tokens.claims() pode retornar undefined em casos de erro ou token inválido
  const claims = tokens.claims();
  if (!claims) {
    throw new Error('Token OAuth não contém claims - autenticação falhou');
  }
  
  // Type assertion para IdTokenClaims - tokens.claims() retorna objeto compatível quando válido
  user.claims = claims as IdTokenClaims;
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: IdTokenClaims) {
  // BUG FIX 23/12/2025: Validação defensiva - sub é obrigatório para criar/atualizar usuário
  // Se sub não existir, lançar erro ao invés de crashar com undefined reference
  if (!claims?.sub) {
    throw new Error('ID token claims não contém sub (subject) - token OAuth inválido');
  }

  // BUG FIX 23/12/2025: Preservar undefined para campos opcionais ausentes (não usar "" como fallback)
  // undefined será convertido para NULL no banco, mantendo distinção semântica:
  // - NULL = campo não fornecido no token OAuth
  // - "" = campo explicitamente vazio
  // Isso preserva queries que filtram por IS NULL e analytics que distinguem ausente vs vazio
  await storage.upsertUser({
    id: claims.sub,
    email: claims.email ?? undefined,
    firstName: claims.first_name ?? undefined,
    lastName: claims.last_name ?? undefined,
    profileImageUrl: claims.profile_image_url ?? undefined,
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    try {
      const user: UserSession = {};
      
      // BUG FIX 23/12/2025: Validação defensiva antes de type assertion
      // tokens.claims() pode retornar undefined em casos de erro ou token inválido
      // updateUserSession já valida claims, mas precisamos validar aqui também para upsertUser
      const claims = tokens.claims();
      if (!claims) {
        return verified(new Error('Token OAuth não contém claims - autenticação falhou'));
      }
      
      updateUserSession(user, tokens);
      await upsertUser(claims as IdTokenClaims);
      verified(null, user as Express.User);
    } catch (error) {
      // Tratar erros de validação ou upsert como falha de autenticação
      verified(error instanceof Error ? error : new Error('Erro ao processar autenticação OAuth'));
    }
  };

  const registeredStrategies = new Set<string>();

  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify,
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as UserSession;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
