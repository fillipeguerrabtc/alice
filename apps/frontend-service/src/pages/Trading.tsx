import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { hasPermission } from '@/lib/authUtils';
import {
  useTradingAuthRedirect,
  useTradingPermissionsQuery,
  TradingAuthRequiredScreen,
  TradingForbiddenScreen,
  TradingLoadingScreen,
  resolveTradingLoadingMessage,
} from '@/components/trading';
import { TradingContent } from './TradingContent';

/**
 * Wrapper de autenticação/permissão do Trading.
 *
 * Mantém o composition root fino e monta TradingContent apenas quando
 * autenticação e autorização já foram resolvidas.
 */
export default function Trading() {
  const { t } = useTranslation();
  const { user, isLoading: isAuthLoading } = useAuth();
  const userRoles = user?.roles ?? (user?.role ? [user.role] : []);
  const loadingMessage = resolveTradingLoadingMessage(t);
  const handleLoginRedirect = useTradingAuthRedirect();
  const { isPermissionsLoading, permissionsData } = useTradingPermissionsQuery({
    userId: user?.id,
  });

  if (isAuthLoading) {
    return <TradingLoadingScreen message={loadingMessage} />;
  }

  if (!user?.id) {
    return (
      <TradingAuthRequiredScreen
        description={t('auth.requiredMessage', {
          defaultValue: 'Você precisa estar autenticado para acessar o Trading.',
        })}
        loginLabel={t('auth.login', { defaultValue: 'Fazer Login' })}
        onLogin={handleLoginRedirect}
        title={t('auth.required', { defaultValue: 'Autenticação Necessária' })}
      />
    );
  }

  if (isPermissionsLoading) {
    return <TradingLoadingScreen message={loadingMessage} />;
  }

  const canReadTrading = hasPermission(
    permissionsData?.permissions,
    'integrations:trading:read',
    userRoles
  );

  if (!canReadTrading) {
    return (
      <TradingForbiddenScreen
        description={t('auth.requiredMessage', {
          defaultValue: 'Você não possui permissão para acessar este módulo.',
        })}
        title={t('common.forbidden', { defaultValue: 'Acesso negado' })}
      />
    );
  }

  return <TradingContent />;
}
