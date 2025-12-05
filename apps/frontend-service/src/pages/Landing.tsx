/**
 * Landing Page - Alice Enterprise Platform
 * 
 * Página inicial pública com informações sobre a plataforma.
 * Internacionalização completa (Regra 13 - i18n)
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitch } from "@/components/language-switch";
import {
  Bot,
  Shield,
  Globe,
  BarChart3,
  MessageSquare,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Car,
  Calendar,
  Users,
  FileText,
} from "lucide-react";

export default function Landing() {
  const { t } = useTranslation();

  const recursos = [
    {
      icone: Bot,
      chave: 'autonomous',
    },
    {
      icone: Calendar,
      chave: 'multimodal',
    },
    {
      icone: CreditCard,
      chave: 'selfHosted',
    },
    {
      icone: MessageSquare,
      chave: 'integrations',
    },
    {
      icone: Car,
      chave: 'agents',
    },
    {
      icone: Shield,
      chave: 'security',
    },
    {
      icone: FileText,
      chave: 'rag',
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <img
              src="/logo-round.png"
              alt="Yes You Deserve"
              className="h-10 w-10 rounded-xl"
              data-testid="img-header-logo"
            />
            <span className="text-xl font-semibold">{t('auth.title')}</span>
          </div>

          <nav className="hidden md:flex items-center gap-6">
            <a
              href="#servicos"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-servicos"
            >
              {t('nav.features')}
            </a>
            <a
              href="#beneficios"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-beneficios"
            >
              {t('landing.benefits.title')}
            </a>
            <a
              href="#contato"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-contato"
            >
              {t('landing.contact')}
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <LanguageSwitch />
            <ThemeToggle />
            <a href="/api/login">
              <Button data-testid="button-login">
                {t('auth.login')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden py-24 md:py-32">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
          <div className="container mx-auto px-4 md:px-6 relative">
            <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
              <div className="mb-8">
                <img
                  src="/logo-round.png"
                  alt="Yes You Deserve"
                  className="h-24 w-24 rounded-2xl shadow-lg"
                  data-testid="img-hero-logo"
                />
              </div>

              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground mb-6">
                <Bot className="h-4 w-4 text-primary" />
                {t('auth.subtitle')}
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground mb-6">
                {t('landing.hero.title')}{" "}
                <span className="text-primary">{t('landing.hero.titleHighlight')}</span>
              </h1>

              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-8">
                {t('landing.description')}
              </p>

              <a href="/api/login">
                <Button size="lg" data-testid="button-hero-entrar">
                  {t('landing.cta')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </a>

              <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  {t('landing.companyLocation')}
                </div>
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  {t('landing.autonomous')}
                </div>
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  {t('landing.metricsEur')}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="servicos" className="py-24 bg-muted/30">
          <div className="container mx-auto px-4 md:px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-foreground mb-4">
                {t('landing.features.title')}
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                {t('landing.features.subtitle')}
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {recursos.map((recurso, index) => (
                <Card
                  key={index}
                  className="hover-elevate transition-all duration-200"
                  data-testid={`card-servico-${index}`}
                >
                  <CardContent className="p-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                      <recurso.icone className="h-6 w-6" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {t(`landing.features.${recurso.chave}.title`)}
                    </h3>
                    <p className="text-muted-foreground">
                      {t(`landing.features.${recurso.chave}.description`)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section id="beneficios" className="py-24">
          <div className="container mx-auto px-4 md:px-6">
            <div className="grid gap-12 lg:grid-cols-2 items-center">
              <div>
                <h2 className="text-3xl font-bold text-foreground mb-6">
                  {t('landing.benefits.title')}
                </h2>
                <p className="text-lg text-muted-foreground mb-8">
                  {t('landing.benefits.subtitle')}
                </p>

                <ul className="space-y-4">
                  {(t('landing.benefits.items', { returnObjects: true }) as string[]).map((beneficio, index) => (
                    <li
                      key={index}
                      className="flex items-center gap-3"
                      data-testid={`beneficio-${index}`}
                    >
                      <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                      <span className="text-foreground">{beneficio}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="relative">
                <Card className="p-8 bg-gradient-to-br from-primary/5 to-accent/5">
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <img
                        src="/logo-round.png"
                        alt="Yes You Deserve"
                        className="h-14 w-14 rounded-xl"
                        data-testid="img-card-logo"
                      />
                      <div>
                        <h3 className="font-semibold text-foreground">
                          {t('auth.title')}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {t('auth.subtitle')}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-lg bg-background p-4">
                        <p className="text-2xl font-bold text-primary">{t('landing.model.activeParameters')}</p>
                        <p className="text-sm text-muted-foreground">
                          {t('landing.model.parameters')}
                        </p>
                      </div>
                      <div className="rounded-lg bg-background p-4">
                        <p className="text-2xl font-bold text-primary">{t('landing.model.contextTokens')}</p>
                        <p className="text-sm text-muted-foreground">
                          Tokens
                        </p>
                      </div>
                      <div className="rounded-lg bg-background p-4">
                        <p className="text-2xl font-bold text-primary">
                          <Users className="inline h-6 w-6" />
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Multi-tenant
                        </p>
                      </div>
                      <div className="rounded-lg bg-background p-4">
                        <p className="text-2xl font-bold text-primary">{t('landing.model.availability')}</p>
                        <p className="text-sm text-muted-foreground">
                          24/7
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </section>

        <section
          id="contato"
          className="py-24 bg-gradient-to-b from-muted/30 to-background"
        >
          <div className="container mx-auto px-4 md:px-6 text-center">
            <h2 className="text-3xl font-bold text-foreground mb-4">
              {t('landing.readyToStart')}
            </h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
              {t('landing.readyToStartDescription')}
            </p>

            <a href="/api/login">
              <Button size="lg" data-testid="button-cta-entrar">
                {t('landing.viewDemo')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-12">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img
                src="/logo-round.png"
                alt="Yes You Deserve"
                className="h-8 w-8 rounded-lg"
                data-testid="img-footer-logo"
              />
              <span className="font-semibold">{t('auth.title')}</span>
            </div>

            <p className="text-sm text-muted-foreground">
              {new Date().getFullYear()} {t('landing.copyright')}
            </p>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground transition-colors">
                {t('landing.termsOfService')}
              </a>
              <a href="#" className="hover:text-foreground transition-colors">
                {t('landing.privacy')}
              </a>
              <a href="#" className="hover:text-foreground transition-colors">
                {t('landing.contact')}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
