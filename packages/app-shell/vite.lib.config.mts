// Library build of the editor UI for the VS Code webview (003 T5): `mountApp` (src/app.ts) with
// Svelte, vanilla-jsoneditor and their CSS bundled into dist/lib/app.js and dist/lib/app.css. The
// extension's esbuild bundles both into its webview script and stylesheet, which the webview loads
// from its own source with the CSP nonce (spec 003 criterion 6, UNK-029).
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { libraryCss } from './vite-plugin-library-css.mts';

export default defineConfig({
  plugins: [libraryCss(), svelte()],
  build: {
    outDir: 'dist/lib',
    emptyOutDir: true,
    lib: { entry: 'src/app.ts', formats: ['es'], fileName: 'app', cssFileName: 'app' },
  },
});
