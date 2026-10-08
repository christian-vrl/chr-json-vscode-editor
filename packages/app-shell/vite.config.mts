// Vite build of app-shell's standalone page (001 T6, 003 T2). `pnpm test:web` serves dist/web with
// `vite preview`. The Svelte plugin compiles the UI's .svelte components (UNK-010).
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [svelte()],
  build: { outDir: 'dist/web', emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
