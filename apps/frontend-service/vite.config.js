import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
var __dirname = path.dirname(fileURLToPath(import.meta.url));
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
