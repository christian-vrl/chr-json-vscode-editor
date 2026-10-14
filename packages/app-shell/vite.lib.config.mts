// Library build of the editor UI for the VS Code webview (003 T5): `mountApp` (src/app.ts) with
// Svelte, vanilla-jsoneditor and their CSS bundled into dist/lib/app.js and dist/lib/app.css, the
// compare page's `mountCompare` (src/compare.ts, 007 T4) into dist/lib/compare.js, and the CSV
// panel page's `mountCsv` (src/csv.ts, 009 T3) into dist/lib/csv.js, and the JavaScript and Lodash
// query engine (src/query/engine.ts, 011 T4) into dist/lib/engine.js with its chunks, which no page
// script imports statically: a host loads it with `import()` by its URI when Transform first opens
// (011 T1 REPORT §3, route (a)) and passes it to `mountApp`. Every page's CSS lands in the
// one dist/lib/app.css. The extension's esbuild bundles each into its webview script and
// stylesheet, which the webview loads from its own source with the CSP nonce (spec 003 criterion
// 6, UNK-029). Core is not bundled here: the extension's esbuild bundles it once per page.
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
      entry: {
        app: 'src/app.ts',
        compare: 'src/compare.ts',
        csv: 'src/csv.ts',
        engine: 'src/query/engine.ts',
      },
      formats: ['es'],
      cssFileName: 'app',
    },
    // Core stays an import, so the extension's esbuild bundles one copy of it (and of lossless-json)
    // for a page and the host adapter around it: a big number made on one side must be an
    // `instanceof LosslessNumber` on the other (spec 015 B5, 015 T4).
    rollupOptions: { external: ['@chr-json-editor/core'] },
  },
});
