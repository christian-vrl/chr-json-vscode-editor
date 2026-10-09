// Vite build of app-shell's standalone page (001 T6, 003 T2). `pnpm test:web` serves dist/web with
// `vite preview`. The Svelte plugin compiles the UI's .svelte components (UNK-010); libraryCss moves
// vanilla-jsoneditor's runtime-injected CSS into the CSS bundle (UNK-029). vite.lib.config.mts builds
// the same UI as a library for the VS Code webview (003 T5).
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { libraryCss } from './vite-plugin-library-css.mts';

export default defineConfig({
  base: './',
  plugins: [libraryCss(), svelte()],
  // The library's text mode places validation errors with json-source-map, which reads strict
  // JSON only; src/source-map.ts maps JSONC and JSON5 too (004 T5).
  resolve: {
    alias: { 'json-source-map': fileURLToPath(new URL('./src/source-map.ts', import.meta.url)) },
  },
  build: { outDir: 'dist/web', emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
