import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
var __dirname = path.dirname(fileURLToPath(import.meta.url));
function requireEnv(name) {
    var value = (process.env[name] || '').trim();
    if (!value) {
        throw new Error("Variável de ambiente ".concat(name, " é obrigatória para o Vite dev server (Regra 6 - fail-fast)"));
    }
    return value;
}
// REGRA 6: Sem hardcoded/fallback de URLs - dev usa integrações reais via env
var AUTH_SERVICE_URL = requireEnv('AUTH_SERVICE_URL');
var CHAT_SERVICE_URL = requireEnv('CHAT_SERVICE_URL');
var RAG_SERVICE_URL = requireEnv('RAG_SERVICE_URL');
var TRAINING_SERVICE_URL = requireEnv('TRAINING_SERVICE_URL');
var INTEGRATIONS_SERVICE_URL = requireEnv('INTEGRATIONS_SERVICE_URL');
var WS_URL = requireEnv('WS_URL');
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
