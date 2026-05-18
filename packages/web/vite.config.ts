import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/ws': {
                target: 'http://localhost:3000',
                ws: true,
            },
            '/api': {
                target: 'http://localhost:3000',
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
