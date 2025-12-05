// Componente de Troca de Idioma - Alice Enterprise Platform
// Conforme CLAUDE.md: Language switch OBRIGATÓRIO em TODAS as páginas (Regra 13)

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Globe } from "lucide-react";
import { SUPPORTED_LANGUAGES, changeLanguage, type Language } from "@/lib/i18n";

export function LanguageSwitch() {
  const { i18n } = useTranslation();
  const currentLang = i18n.language as Language;

  // Encontrar idioma atual
  const currentLanguage = SUPPORTED_LANGUAGES.find(
    (lang) => lang.code === currentLang
  ) || SUPPORTED_LANGUAGES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-testid="button-language-toggle"
          aria-label={`Idioma atual: ${currentLanguage.label}`}
        >
          <Globe className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => changeLanguage(lang.code)}
            className={currentLang === lang.code ? "bg-accent" : ""}
            data-testid={`button-language-${lang.code}`}
          >
            {lang.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default LanguageSwitch;
