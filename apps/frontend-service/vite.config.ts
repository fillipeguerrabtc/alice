import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variável de ambiente ${name} é obrigatória para o Vite dev server (Regra 6 - fail-fast)`);
  }
  return value;
}

// REGRA 6: Sem hardcoded/fallback de URLs - dev usa integrações reais via env
const AUTH_SERVICE_URL = requireEnv('AUTH_SERVICE_URL');
const CHAT_SERVICE_URL = requireEnv('CHAT_SERVICE_URL');
const RAG_SERVICE_URL = requireEnv('RAG_SERVICE_URL');
const TRAINING_SERVICE_URL = requireEnv('TRAINING_SERVICE_URL');
const INTEGRATIONS_SERVICE_URL = requireEnv('INTEGRATIONS_SERVICE_URL');
const WS_URL = requireEnv('WS_URL');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/lib': path.resolve(__dirname, './src/lib'),
      '@/hooks': path.resolve(__dirname, './src/hooks'),
      '@shared': path.resolve(__dirname, '../shared'),
      '@assets': path.resolve(__dirname, '../attached_assets'),
      '@alice/shared': path.resolve(__dirname, '../packages/shared/src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    proxy: {
      '/api/auth': {
        target: AUTH_SERVICE_URL,
        changeOrigin: true,
      },
      '/api/chat': {
        target: CHAT_SERVICE_URL,
        changeOrigin: true,
      },
      '/api/rag': {
        target: RAG_SERVICE_URL,
        changeOrigin: true,
      },
      '/api/training': {
        target: TRAINING_SERVICE_URL,
        changeOrigin: true,
      },
      '/api/integrations': {
        target: INTEGRATIONS_SERVICE_URL,
        changeOrigin: true,
      },
      '/ws': {
        target: WS_URL,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // PERFORMANCE: esbuild para builds mais rápidos (Vite 7 2025 Best Practices)
    minify: 'esbuild',
    // PERFORMANCE: target moderno para código mais otimizado
    target: 'esnext',
    rollupOptions: {
      output: {
        // PERFORMANCE: Separação de chunks para melhor caching (2025 Best Practices)
        manualChunks: {
          // React core
          'vendor-react': ['react', 'react-dom'],
          // UI framework (shadcn/radix)
          'vendor-ui': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-toast',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-scroll-area',
          ],
          // Charting
          'vendor-charts': ['recharts'],
          // Internationalization
          'vendor-i18n': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          // Query and routing
          'vendor-query': ['@tanstack/react-query', 'wouter'],
          // Motion/animations
          'vendor-motion': ['framer-motion'],
        },
      },
    },
    chunkSizeWarningLimit: 500,
    // PERFORMANCE: CSS code splitting para melhor caching
    cssCodeSplit: true,
    // PERFORMANCE: Desabilitar assets inline para melhor caching
    assetsInlineLimit: 4096,
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
  },
});
