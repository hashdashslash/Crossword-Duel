import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    host: true,
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:3001' },
  },
});
