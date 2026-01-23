/**
 * Settings Page - Alice Enterprise Platform
 * 
 * Página de configurações do usuário e organização.
 * Internacionalização completa (Regra 13 - i18n)
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Building, Bell, Shield, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { LanguageSwitch } from '@/components/language-switch';
import { apiRequest } from '@/lib/queryClient';
import { useMutation } from '@tanstack/react-query';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('profile');
  const [profileForm, setProfileForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    preferredName: user?.preferredName || '',
  });

  useEffect(() => {
    setProfileForm({
      firstName: user?.firstName || '',
      lastName: user?.lastName || '',
      preferredName: user?.preferredName || '',
    });
  }, [user]);

  const updateProfile = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('Usuário inválido');
      await apiRequest('PATCH', `/api/users/${user.id}`, {
        firstName: profileForm.firstName || undefined,
        lastName: profileForm.lastName || undefined,
        preferredName: profileForm.preferredName || undefined,
      });
    },
  });

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
                  onClick={() => updateProfile.mutate()}
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
                <Button data-testid="button-save-language">
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
