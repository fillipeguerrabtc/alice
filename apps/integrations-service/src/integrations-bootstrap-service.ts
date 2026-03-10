import nodemailer from 'nodemailer';
import Stripe from 'stripe';

type BootstrapLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type InitializeGmailTransporterParams = {
  gmailUser?: string;
  gmailAppPassword?: string;
  isProduction: boolean;
  logger: BootstrapLogger;
  onCriticalFailure?: (error: Error) => void;
};

export function initializeGmailTransporter(params: InitializeGmailTransporterParams): nodemailer.Transporter | null {
  const { gmailUser, gmailAppPassword, isProduction, logger, onCriticalFailure } = params;

  if (gmailUser && gmailAppPassword) {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: gmailUser,
        pass: gmailAppPassword,
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 10,
    });

    transporter.verify()
      .then(() => {
        logger.info({ user: gmailUser }, 'Gmail SMTP conectado com sucesso');
      })
      .catch((error: unknown) => {
        logger.error({ error, user: gmailUser }, 'Falha ao conectar Gmail SMTP');
        if (isProduction) {
          const criticalError = error instanceof Error
            ? error
            : new Error('Gmail SMTP é obrigatório em produção (Regra 6 - fail-fast)');
          logger.error('Gmail SMTP é obrigatório em produção (Regra 6 - fail-fast)');
          if (onCriticalFailure) {
            onCriticalFailure(criticalError);
            return;
          }
          throw criticalError;
        }
      });

    return transporter;
  }

  if (isProduction) {
    const error = new Error('GMAIL_USER e GMAIL_APP_PASSWORD são obrigatórios em produção (Regra 6 - fail-fast)');
    logger.error(error.message);
    if (onCriticalFailure) {
      onCriticalFailure(error);
      return null;
    }
    throw error;
  }

  logger.warn('Gmail SMTP não configurado - emails desabilitados em desenvolvimento');
  return null;
}

type InitializeStripeClientParams = {
  stripeSecretKey?: string;
  stripeApiVersion: Stripe.LatestApiVersion;
  logger: BootstrapLogger;
};

export function initializeStripeClient(params: InitializeStripeClientParams): Stripe | null {
  const { stripeSecretKey, stripeApiVersion, logger } = params;
  if (!stripeSecretKey) {
    return null;
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: stripeApiVersion,
  });
  logger.info({ apiVersion: stripeApiVersion }, 'Cliente Stripe inicializado');
  return stripe;
}
