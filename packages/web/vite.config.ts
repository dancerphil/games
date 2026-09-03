import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
        conditions: ['source'],
    },
    server: {
        port: 8792,
        proxy: {
            '/ws': {
                target: 'http://localhost:8791',
                ws: true,
                changeOrigin: true,
            },
            '/api': {
                target: 'http://localhost:8791',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: '../server/public',
        emptyOutDir: true,
    },
    preview: {
        port: 8794,
        allowedHosts: ['games.dancerphil.com'],
    },
});
