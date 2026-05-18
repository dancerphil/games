import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/ws': {
                target: 'http://localhost:8789',
                ws: true,
                changeOrigin: true,
            },
            '/api': {
                target: 'http://localhost:8789',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: '../server/public',
        emptyOutDir: true,
    },
    preview: {
        allowedHosts: ['games.dancerphil.com'],
    },
});
