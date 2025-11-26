/// <reference types="vite/client" />

// Declaração de tipos para variáveis de ambiente Vite
// Conforme replit.md: TypeScript strict, zero LSP errors
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_APP_TITLE?: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
