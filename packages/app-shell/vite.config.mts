// Vite build of app-shell's page (001 T6). `pnpm test:web` serves dist/web with `vite preview`.
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist/web', emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
