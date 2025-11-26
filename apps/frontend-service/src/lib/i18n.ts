// Configuração i18n - Alice Enterprise Platform
// Biblioteca: react-i18next + i18next (conforme replit.md REGRA 11 e 13)
// Idioma principal: Português Brasileiro (pt-BR)
// Idioma secundário: English (en)
// Timezone: Europe/Lisbon (Portugal)

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Importar traduções
import ptBR from "../locales/pt-BR.json";
import en from "../locales/en.json";

// Configuração de Timezone - Portugal (Europe/Lisbon)
export const TIMEZONE = "Europe/Lisbon";
export const TIMEZONE_OFFSET = "WET/WEST"; // Western European Time

// Recursos de tradução
const resources = {
  "pt-BR": {
    translation: ptBR,
  },
  en: {
    translation: en,
  },
};

// Inicializar i18next
i18n
  .use(LanguageDetector) // Detecta idioma do navegador
  .use(initReactI18next) // Integração com React
  .init({
    resources,
    fallbackLng: "pt-BR", // Idioma de fallback (conforme replit.md)
    lng: "pt-BR", // Idioma padrão (conforme replit.md)
    
    // Detecção de idioma
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: "alice-language",
      caches: ["localStorage"],
    },

    interpolation: {
      escapeValue: false, // React já escapa XSS
    },

    // Configurações de namespace
    ns: ["translation"],
    defaultNS: "translation",

    // Debug apenas em desenvolvimento
    debug: import.meta.env.DEV,

    // Retornar chave vazia se tradução não existir
    returnEmptyString: false,
    returnNull: false,
  });

export default i18n;

// Tipos exportados para uso em componentes
export type Language = "pt-BR" | "en";

export const SUPPORTED_LANGUAGES: { code: Language; label: string }[] = [
  { code: "pt-BR", label: "Português (BR)" },
  { code: "en", label: "English" },
];

// Helper para trocar idioma
export const changeLanguage = (lang: string): void => {
  const validLang = (lang === "pt-BR" || lang === "en") ? lang : "pt-BR";
  i18n.changeLanguage(validLang);
  localStorage.setItem("alice-language", validLang);
};

// Helper para obter idioma atual
export const getCurrentLanguage = (): Language => {
  return (i18n.language as Language) || "pt-BR";
};
