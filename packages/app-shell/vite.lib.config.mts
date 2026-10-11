// Library build of the editor UI for the VS Code webview (003 T5): `mountApp` (src/app.ts) with
// Svelte, vanilla-jsoneditor and their CSS bundled into dist/lib/app.js and dist/lib/app.css, and
// the compare page's `mountCompare` (src/compare.ts, 007 T4) into dist/lib/compare.js. Both pages'
// CSS lands in the one dist/lib/app.css. The
// extension's esbuild bundles both into its webview script and stylesheet, which the webview loads
// from its own source with the CSP nonce (spec 003 criterion 6, UNK-029).
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { libraryCss } from './vite-plugin-library-css.mts';

export default defineConfig({
  plugins: [libraryCss(), svelte()],
  // The library's text mode places validation errors with json-source-map, which reads strict
  // JSON only; src/source-map.ts maps JSONC and JSON5 too (004 T5).
  resolve: {
    alias: { 'json-source-map': fileURLToPath(new URL('./src/source-map.ts', import.meta.url)) },
  },
  build: {
    outDir: 'dist/lib',
    emptyOutDir: true,
    lib: {
      entry: { app: 'src/app.ts', compare: 'src/compare.ts' },
      formats: ['es'],
      cssFileName: 'app',
    },
  },
});
