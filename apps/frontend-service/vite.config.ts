import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
        target: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/chat': {
        target: process.env.CHAT_SERVICE_URL || 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/rag': {
        target: process.env.RAG_SERVICE_URL || 'http://localhost:3003',
        changeOrigin: true,
      },
      '/api/training': {
        target: process.env.TRAINING_SERVICE_URL || 'http://localhost:3004',
        changeOrigin: true,
      },
      '/api/integrations': {
        target: process.env.INTEGRATIONS_SERVICE_URL || 'http://localhost:3005',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.WS_URL || 'ws://localhost:3002',
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
