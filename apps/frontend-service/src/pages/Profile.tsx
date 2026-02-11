/**
 * Profile Page - Alice Enterprise Platform
 *
 * Página dedicada ao perfil do usuário e preferências pessoais.
 * Separada das configurações de sistema (SystemSettings).
 * Internacionalização completa (Regra 13 - i18n)
 *
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Bell, Shield, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { LanguageSwitch } from '@/components/language-switch';
import { apiRequest } from '@/lib/queryClient';
import { TIMEZONE } from '@/lib/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BiometricCapture } from '@/components/biometrics/BiometricCapture';

type UpdateUserPayload = {
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  idioma?: string;
  timezone?: string;
  preferencias?: {
    location?: {
      countryCode?: string;
      countryName?: string;
      region?: string;
      city?: string;
    } | null;
  };
};

export default function Profile() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('profile');
  const queryClient = useQueryClient();
  const [profileForm, setProfileForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    preferredName: user?.preferredName || '',
  });
  const [regionalForm, setRegionalForm] = useState({
    idioma: user?.idioma || i18n.language || 'pt-BR',
    timezone: user?.timezone || TIMEZONE,
    countryName: user?.preferencias?.location?.countryName || '',
    countryCode: user?.preferencias?.location?.countryCode || '',
    region: user?.preferencias?.location?.region || '',
    city: user?.preferencias?.location?.city || '',
  });
  const [biometricStatus, setBiometricStatus] = useState<{ enrolled: boolean; lastVerifiedAt?: string | null } | null>(null);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [biometricCaptureStep, setBiometricCaptureStep] = useState(0);
  const [biometricEnrollPending, setBiometricEnrollPending] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const maxBiometricCaptures = 3;

  useEffect(() => {
    setProfileForm({
      firstName: user?.firstName || '',
      lastName: user?.lastName || '',
      preferredName: user?.preferredName || '',
    });
    setRegionalForm({
      idioma: user?.idioma || i18n.language || 'pt-BR',
      timezone: user?.timezone || TIMEZONE,
      countryName: user?.preferencias?.location?.countryName || '',
      countryCode: user?.preferencias?.location?.countryCode || '',
      region: user?.preferencias?.location?.region || '',
      city: user?.preferencias?.location?.city || '',
    });
  }, [user, i18n.language]);

  useEffect(() => {
    if (activeTab !== 'security' || !user?.id) return;
    setBiometricLoading(true);
    apiRequest('POST', '/api/auth/biometrics/status')
      .then((res) => res.json())
      .then((data) => setBiometricStatus(data))
      .catch(() => setBiometricStatus(null))
      .finally(() => setBiometricLoading(false));
  }, [activeTab, user?.id]);

  useEffect(() => {
    if (activeTab !== 'security') {
      setBiometricCaptureStep(0);
      setBiometricEnrollPending(false);
    }
  }, [activeTab]);

  const updateProfile = useMutation({
    mutationFn: async (payload: UpdateUserPayload) => {
      if (!user?.id) throw new Error('Usuário inválido');
      await apiRequest('PATCH', `/api/users/${user.id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
  });

  const timezoneOptions = useMemo(() => {
    const fallback = [regionalForm.timezone, user?.timezone, TIMEZONE, 'UTC']
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    const uniqueFallback = Array.from(new Set(fallback));
    const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf;
    if (typeof supportedValuesOf !== 'function') {
      return uniqueFallback;
    }
    const supported = supportedValuesOf('timeZone');
    return supported.length > 0 ? supported : uniqueFallback;
  }, [regionalForm.timezone, user?.timezone]);

  const handleSaveProfile = () => {
    updateProfile.mutate(
      {
        firstName: profileForm.firstName.trim() || undefined,
        lastName: profileForm.lastName.trim() || undefined,
        preferredName: profileForm.preferredName.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast({
            title: 'Perfil atualizado',
            description: 'As informações foram salvas com sucesso.',
          });
        },
        onError: () => {
          toast({
            title: 'Falha ao salvar perfil',
            description: 'Não foi possível salvar as informações. Tente novamente.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  const handleSaveRegional = () => {
    const countryName = regionalForm.countryName.trim();
    const countryCode = regionalForm.countryCode.trim().toUpperCase();
    const region = regionalForm.region.trim();
    const city = regionalForm.city.trim();
    const hasLocation = Boolean(countryName || countryCode || region || city);

    updateProfile.mutate(
      {
        idioma: regionalForm.idioma || undefined,
        timezone: regionalForm.timezone || undefined,
        preferencias: hasLocation
          ? {
              location: {
                countryName: countryName || undefined,
                countryCode: countryCode || undefined,
                region: region || undefined,
                city: city || undefined,
              },
            }
          : undefined,
      },
      {
        onSuccess: () => {
          toast({
            title: 'Configurações regionais atualizadas',
            description: 'Idioma, fuso horário e localização foram salvos.',
          });
        },
        onError: () => {
          toast({
            title: 'Falha ao salvar configurações regionais',
            description: 'Não foi possível salvar. Tente novamente.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  const handleBiometricCapture = async (imageBase64: string) => {
    if (biometricEnrollPending) return;
    try {
      setBiometricEnrollPending(true);
      const captureMode = biometricCaptureStep === 0 ? 'replace' : 'append';
      await apiRequest('POST', '/api/auth/biometrics/enroll', { imageBase64, captureMode });
      const nextStep = biometricCaptureStep + 1;
      if (nextStep < maxBiometricCaptures) {
        setBiometricCaptureStep(nextStep);
        toast({
          title: 'Captura registrada',
          description: `Agora faça a captura ${nextStep + 1} de ${maxBiometricCaptures}.`,
        });
      } else {
        setBiometricCaptureStep(0);
        toast({
          title: 'Biometria cadastrada',
          description: 'Sua biometria foi registrada com sucesso.',
        });
        const statusResponse = await apiRequest('POST', '/api/auth/biometrics/status');
        const statusData = await statusResponse.json();
        setBiometricStatus(statusData);
      }
    } catch (error) {
      toast({
        title: 'Falha ao cadastrar biometria',
        description: error instanceof Error ? error.message : 'Não foi possível cadastrar.',
        variant: 'destructive',
      });
    } finally {
      setBiometricEnrollPending(false);
    }
  };

  const handleChangePassword = async () => {
    const currentPassword = passwordForm.currentPassword;
    const newPassword = passwordForm.newPassword;
    const confirmPassword = passwordForm.confirmPassword;

    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({
        title: 'Preencha todos os campos',
        description: 'Informe senha atual, nova senha e confirmação.',
        variant: 'destructive',
      });
      return;
    }
    if (newPassword.length < 8) {
      toast({
        title: 'Senha muito curta',
        description: 'A nova senha deve ter no mínimo 8 caracteres.',
        variant: 'destructive',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: 'Confirmação inválida',
        description: 'A nova senha e a confirmação devem ser iguais.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await apiRequest('POST', '/api/auth/change-password', {
        currentPassword,
        newPassword,
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast({
        title: 'Senha atualizada',
        description: 'Sua senha foi alterada com sucesso.',
      });
    } catch (error) {
      toast({
        title: 'Falha ao atualizar senha',
        description: error instanceof Error ? error.message : 'Não foi possível alterar a senha.',
        variant: 'destructive',
      });
    }
  };

  const tabs = [
    { id: 'profile', labelKey: 'auth.profile', icon: User },
    { id: 'notifications', labelKey: 'profile.notifications', icon: Bell },
    { id: 'security', labelKey: 'profile.security', icon: Shield },
    { id: 'language', labelKey: 'profile.language', icon: Globe },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
          {t('profile.title')}
        </h1>
        <p className="text-muted-foreground">{t('profile.description')}</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <nav className="w-full md:w-64 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                activeTab === tab.id ? 'bg-primary text-primary-foreground' : 'hover-elevate'
              }`}
              data-testid={`tab-${tab.id}`}
            >
              <tab.icon className="h-4 w-4" />
              {t(tab.labelKey)}
            </button>
          ))}
        </nav>

        <div className="flex-1">
          {activeTab === 'profile' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('auth.profile')}</CardTitle>
                <CardDescription>{t('settings.profileDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium">{t('auth.firstName')}</label>
                    <Input
                      type="text"
                      value={profileForm.firstName}
                      onChange={(event) => setProfileForm((prev) => ({ ...prev, firstName: event.target.value }))}
                      className="mt-1"
                      data-testid="input-first-name"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t('auth.lastName')}</label>
                    <Input
                      type="text"
                      value={profileForm.lastName}
                      onChange={(event) => setProfileForm((prev) => ({ ...prev, lastName: event.target.value }))}
                      className="mt-1"
                      data-testid="input-last-name"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">{t('settings.preferredNameLabel')}</label>
                  <p className="text-xs text-muted-foreground mt-1">{t('settings.preferredNameDesc')}</p>
                  <Input
                    type="text"
                    value={profileForm.preferredName}
                    onChange={(event) => setProfileForm((prev) => ({ ...prev, preferredName: event.target.value }))}
                    className="mt-2"
                    data-testid="input-preferred-name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">{t('auth.email')}</label>
                  <Input
                    type="email"
                    defaultValue={user?.email || ''}
                    disabled
                    className="mt-1 bg-muted"
                    data-testid="input-email"
                  />
                </div>
                <Button data-testid="button-save-profile" onClick={handleSaveProfile} disabled={updateProfile.isPending}>
                  {t('common.save')}
                </Button>
              </CardContent>
            </Card>
          )}

          {activeTab === 'notifications' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('profile.notifications')}</CardTitle>
                <CardDescription>{t('profile.notificationsDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { id: 'email', labelKey: 'integrations.email.title' },
                  { id: 'training', labelKey: 'nav.training' },
                  { id: 'integrations', labelKey: 'nav.integrations' },
                  { id: 'usage', labelKey: 'dashboard.resourceUsage' },
                ].map((notification) => (
                  <div key={notification.id} className="flex items-center justify-between">
                    <span className="text-sm">{t(notification.labelKey)}</span>
                    <Switch defaultChecked={true} data-testid={`toggle-${notification.id}`} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {activeTab === 'security' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('profile.security')}</CardTitle>
                <CardDescription>{t('profile.securityDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="pt-2">
                  <h4 className="font-medium mb-2">Biometria facial</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Cadastre sua biometria para login e aprovações com segurança adicional.
                  </p>
                  <ul className="text-xs text-muted-foreground mb-3 list-disc pl-4 space-y-1">
                    <li>Fique de frente para a câmera com boa iluminação (sem sombras fortes).</li>
                    <li>Centralize o rosto e mantenha distância de 40–60 cm.</li>
                    <li>Remova óculos escuros, bonés ou acessórios que escondam o rosto.</li>
                    <li>Serão feitas 3 capturas: frontal, leve inclinação à esquerda e à direita.</li>
                  </ul>
                  {biometricLoading ? (
                    <p className="text-xs text-muted-foreground">Carregando status da biometria...</p>
                  ) : biometricStatus?.enrolled ? (
                    <p className="text-xs text-emerald-600">
                      Biometria cadastrada
                      {biometricStatus.lastVerifiedAt
                        ? ` (última verificação: ${new Date(biometricStatus.lastVerifiedAt).toLocaleString('pt-BR')})`
                        : ''}
                      .
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Biometria não cadastrada.</p>
                  )}
                  {biometricCaptureStep > 0 && (
                    <p className="text-xs text-amber-600 mt-2">
                      Captura {biometricCaptureStep + 1} de {maxBiometricCaptures}: ajuste levemente o ângulo do rosto.
                    </p>
                  )}
                  <div className="mt-3">
                    <BiometricCapture
                      autoStart={false}
                      onCapture={handleBiometricCapture}
                      onError={(message) => {
                        toast({ title: 'Falha na câmera', description: message, variant: 'destructive' });
                      }}
                    />
                  </div>
                </div>
                <div className="pt-4 border-t space-y-3">
                  <h4 className="font-medium">Alterar senha</h4>
                  <p className="text-sm text-muted-foreground">Atualize sua senha local com segurança.</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-sm font-medium">Senha atual</label>
                      <Input
                        type="password"
                        value={passwordForm.currentPassword}
                        onChange={(event) =>
                          setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))
                        }
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Nova senha</label>
                      <Input
                        type="password"
                        value={passwordForm.newPassword}
                        onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                        className="mt-1"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-sm font-medium">Confirmar nova senha</label>
                      <Input
                        type="password"
                        value={passwordForm.confirmPassword}
                        onChange={(event) =>
                          setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))
                        }
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <Button variant="outline" onClick={handleChangePassword} data-testid="button-change-password">
                    Atualizar senha
                  </Button>
                </div>
                <div className="pt-4 border-t">
                  <h4 className="font-medium mb-2">{t('users.lastActive')}</h4>
                  <p className="text-sm text-muted-foreground mb-3">{t('profile.sessionsDesc')}</p>
                  <Button variant="outline" data-testid="button-manage-sessions">
                    {t('common.view')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'language' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('profile.language')}</CardTitle>
                <CardDescription>{t('profile.languageDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium">{t('settings.language')}</label>
                  <div className="mt-2">
                    <LanguageSwitch />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {i18n.language === 'pt-BR' ? 'Português (Brasil)' : 'English'}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">{t('settings.theme')}</label>
                  <Select defaultValue="system">
                    <SelectTrigger className="mt-1" data-testid="select-theme">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">{t('settings.themes.light')}</SelectItem>
                      <SelectItem value="dark">{t('settings.themes.dark')}</SelectItem>
                      <SelectItem value="system">{t('settings.themes.system')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="pt-4 border-t space-y-3">
                  <div>
                    <label className="text-sm font-medium">{t('settings.aliceLanguageLabel')}</label>
                    <p className="text-xs text-muted-foreground mt-1">{t('settings.aliceLanguageDesc')}</p>
                    <Select
                      value={regionalForm.idioma}
                      onValueChange={(value) => setRegionalForm((prev) => ({ ...prev, idioma: value }))}
                    >
                      <SelectTrigger className="mt-2" data-testid="select-alice-language">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                        <SelectItem value="en-US">English (US)</SelectItem>
                        <SelectItem value="es-ES">Español</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t('settings.timezoneLabel')}</label>
                    <p className="text-xs text-muted-foreground mt-1">{t('settings.timezoneDesc')}</p>
                    <Select
                      value={regionalForm.timezone}
                      onValueChange={(value) => setRegionalForm((prev) => ({ ...prev, timezone: value }))}
                    >
                      <SelectTrigger className="mt-2" data-testid="select-timezone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {timezoneOptions.map((timezone) => (
                          <SelectItem key={timezone} value={timezone}>
                            {timezone}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="pt-4 border-t space-y-3">
                  <div>
                    <label className="text-sm font-medium">{t('settings.locationLabel')}</label>
                    <p className="text-xs text-muted-foreground mt-1">{t('settings.locationDesc')}</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-sm font-medium">{t('settings.countryLabel')}</label>
                      <Input
                        type="text"
                        value={regionalForm.countryName}
                        onChange={(event) =>
                          setRegionalForm((prev) => ({ ...prev, countryName: event.target.value }))
                        }
                        className="mt-1"
                        data-testid="input-country-name"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t('settings.countryCodeLabel')}</label>
                      <Input
                        type="text"
                        value={regionalForm.countryCode}
                        onChange={(event) =>
                          setRegionalForm((prev) => ({ ...prev, countryCode: event.target.value.toUpperCase() }))
                        }
                        className="mt-1"
                        maxLength={2}
                        data-testid="input-country-code"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-sm font-medium">{t('settings.regionLabel')}</label>
                      <Input
                        type="text"
                        value={regionalForm.region}
                        onChange={(event) =>
                          setRegionalForm((prev) => ({ ...prev, region: event.target.value }))
                        }
                        className="mt-1"
                        data-testid="input-region"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t('settings.cityLabel')}</label>
                      <Input
                        type="text"
                        value={regionalForm.city}
                        onChange={(event) =>
                          setRegionalForm((prev) => ({ ...prev, city: event.target.value }))
                        }
                        className="mt-1"
                        data-testid="input-city"
                      />
                    </div>
                  </div>
                </div>
                <Button
                  data-testid="button-save-language"
                  onClick={handleSaveRegional}
                  disabled={updateProfile.isPending}
                >
                  {t('common.save')}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
