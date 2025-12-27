import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
var __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper para obter variáveis de ambiente com fallback (proxy só usado em dev)
function getEnvOrDefault(name, defaultValue) {
    var value = (process.env[name] || '').trim();
    // Durante build, usar default (proxy não é usado em produção - SPA estático)
    // Durante dev, usar fallback para localhost se não configurado
    return value || defaultValue;
}

// URLs dos serviços para proxy (apenas usado no dev server, não no build)
var AUTH_SERVICE_URL = getEnvOrDefault('AUTH_SERVICE_URL', 'http://localhost:3001');
var CHAT_SERVICE_URL = getEnvOrDefault('CHAT_SERVICE_URL', 'http://localhost:3002');
var RAG_SERVICE_URL = getEnvOrDefault('RAG_SERVICE_URL', 'http://localhost:3003');
var TRAINING_SERVICE_URL = getEnvOrDefault('TRAINING_SERVICE_URL', 'http://localhost:3004');
var INTEGRATIONS_SERVICE_URL = getEnvOrDefault('INTEGRATIONS_SERVICE_URL', 'http://localhost:3005');
var WS_URL = getEnvOrDefault('WS_URL', 'ws://localhost:3002');
export default defineConfig({
    plugins: [react()],
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
        minify: 'esbuild',
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ['react', 'react-dom'],
                    ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-toast'],
                    charts: ['recharts'],
                },
            },
        },
        chunkSizeWarningLimit: 1000,
    },
    define: {
        __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    },
});
