/**
 * Settings Page - Alice Enterprise Platform
 * 
 * Página de configurações do usuário e organização.
 * Internacionalização completa (Regra 13 - i18n)
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Building, Bell, Shield, Globe } from 'lucide-react';
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

export default function Settings() {
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
    const fallback = [user?.timezone, TIMEZONE, 'UTC'].filter(Boolean) as string[];
    const uniqueFallback = Array.from(new Set(fallback));
    const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf;
    if (typeof supportedValuesOf !== 'function') {
      return uniqueFallback;
    }
    const supported = supportedValuesOf('timeZone');
    return supported.length > 0 ? supported : uniqueFallback;
  }, [user?.timezone]);

  const handleSaveProfile = () => {
    updateProfile.mutate({
      firstName: profileForm.firstName.trim() || undefined,
      lastName: profileForm.lastName.trim() || undefined,
      preferredName: profileForm.preferredName.trim() || undefined,
    }, {
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
    });
  };

  const handleSaveRegional = () => {
    const countryName = regionalForm.countryName.trim();
    const countryCode = regionalForm.countryCode.trim().toUpperCase();
    const region = regionalForm.region.trim();
    const city = regionalForm.city.trim();
    const hasLocation = Boolean(countryName || countryCode || region || city);

    updateProfile.mutate({
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
    }, {
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
    });
  };

  const tabs = [
    { id: 'profile', labelKey: 'auth.profile', icon: User },
    { id: 'organization', labelKey: 'settings.general', icon: Building },
    { id: 'notifications', labelKey: 'settings.notifications', icon: Bell },
    { id: 'security', labelKey: 'settings.security', icon: Shield },
    { id: 'language', labelKey: 'settings.language', icon: Globe },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
          {t('settings.title')}
        </h1>
        <p className="text-muted-foreground">
          {t('settings.general')}
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <nav className="w-full md:w-64 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'hover-elevate'
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
                <CardDescription>
                  {t('settings.profileDescription')}
                </CardDescription>
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
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('settings.preferredNameDesc')}
                  </p>
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
                <Button
                  data-testid="button-save-profile"
                  onClick={handleSaveProfile}
                  disabled={updateProfile.isPending}
                >
                  {t('common.save')}
                </Button>
              </CardContent>
            </Card>
          )}

          {activeTab === 'organization' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('namespaces.tenant')}</CardTitle>
                <CardDescription>
                  {t('settings.general')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium">{t('namespaces.name')}</label>
                  <Input
                    type="text"
                    placeholder={t('namespaces.placeholders.name')}
                    className="mt-1"
                    data-testid="input-org-name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">{t('namespaces.slug')}</label>
                  <Input
                    type="text"
                    placeholder={t('namespaces.placeholders.slug')}
                    className="mt-1"
                    data-testid="input-org-domain"
                  />
                </div>
                <Button data-testid="button-save-org">
                  {t('common.save')}
                </Button>
              </CardContent>
            </Card>
          )}

          {activeTab === 'notifications' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('settings.notifications')}</CardTitle>
                <CardDescription>
                  {t('settings.general')}
                </CardDescription>
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
                    <Switch
                      defaultChecked={true}
                      data-testid={`toggle-${notification.id}`}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {activeTab === 'security' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('settings.security')}</CardTitle>
                <CardDescription>
                  {t('settings.general')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">{t('settings.security')}</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    {t('settings.general')}
                  </p>
                  <Button variant="outline" data-testid="button-enable-2fa">
                    {t('common.confirm')}
                  </Button>
                </div>
                <div className="pt-4 border-t">
                  <h4 className="font-medium mb-2">{t('users.lastActive')}</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    {t('settings.general')}
                  </p>
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
                <CardTitle>{t('settings.language')}</CardTitle>
                <CardDescription>
                  {t('settings.general')}
                </CardDescription>
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
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('settings.aliceLanguageDesc')}
                    </p>
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
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('settings.timezoneDesc')}
                    </p>
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
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('settings.locationDesc')}
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-sm font-medium">{t('settings.countryLabel')}</label>
                      <Input
                        type="text"
                        value={regionalForm.countryName}
                        onChange={(event) => setRegionalForm((prev) => ({ ...prev, countryName: event.target.value }))}
                        className="mt-1"
                        data-testid="input-country-name"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t('settings.countryCodeLabel')}</label>
                      <Input
                        type="text"
                        value={regionalForm.countryCode}
                        onChange={(event) => setRegionalForm((prev) => ({ ...prev, countryCode: event.target.value.toUpperCase() }))}
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
                        onChange={(event) => setRegionalForm((prev) => ({ ...prev, region: event.target.value }))}
                        className="mt-1"
                        data-testid="input-region"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t('settings.cityLabel')}</label>
                      <Input
                        type="text"
                        value={regionalForm.city}
                        onChange={(event) => setRegionalForm((prev) => ({ ...prev, city: event.target.value }))}
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
