import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper para obter variáveis de ambiente com fallback (proxy só usado em dev)
function getEnvOrDefault(name: string, defaultValue: string): string {
  const value = process.env[name]?.trim();
  // Durante build, usar default (proxy não é usado em produção - SPA estático)
  // Durante dev, usar fallback para localhost se não configurado
  return value || defaultValue;
}

// URLs dos serviços para proxy (apenas usado no dev server, não no build)
const AUTH_SERVICE_URL = getEnvOrDefault('AUTH_SERVICE_URL', 'http://localhost:3001');
const CHAT_SERVICE_URL = getEnvOrDefault('CHAT_SERVICE_URL', 'http://localhost:3002');
const RAG_SERVICE_URL = getEnvOrDefault('RAG_SERVICE_URL', 'http://localhost:3003');
const TRAINING_SERVICE_URL = getEnvOrDefault('TRAINING_SERVICE_URL', 'http://localhost:3004');
const INTEGRATIONS_SERVICE_URL = getEnvOrDefault('INTEGRATIONS_SERVICE_URL', 'http://localhost:3005');
const WS_URL = getEnvOrDefault('WS_URL', 'ws://localhost:3002');

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
    // Ajustado para evitar warning falso-positivo em bundle principal proximo de 500kb.
    chunkSizeWarningLimit: 550,
    // PERFORMANCE: CSS code splitting para melhor caching
    cssCodeSplit: true,
    // PERFORMANCE: Desabilitar assets inline para melhor caching
    assetsInlineLimit: 4096,
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
  },
});
