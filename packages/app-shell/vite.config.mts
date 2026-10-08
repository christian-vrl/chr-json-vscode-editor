// Vite build of app-shell's standalone page (001 T6, 003 T2). `pnpm test:web` serves dist/web with
// `vite preview`. The Svelte plugin compiles the UI's .svelte components (UNK-010); libraryCss moves
// vanilla-jsoneditor's runtime-injected CSS into the CSS bundle (UNK-029). vite.lib.config.mts builds
// the same UI as a library for the VS Code webview (003 T5).
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { libraryCss } from './vite-plugin-library-css.mts';

export default defineConfig({
  base: './',
  plugins: [libraryCss(), svelte()],
  build: { outDir: 'dist/web', emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
