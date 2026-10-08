// Bundles the extension host code (001 T5): one CommonJS file for VS Code's Node runtime, with
// `vscode` left external because the editor provides it. Also bundles the webview script (003 T4).
//
// CHR_TEST_HOOKS=1 builds the e2e variant (spec 003 §Acceptance criterion: the test-only hook is
// compiled out of release builds): `__CHR_TEST_HOOKS__` becomes true and `activate` returns
// `testHooks`. Without it the hook code is removed as dead code.
import { build } from 'esbuild';

const testHooks = process.env.CHR_TEST_HOOKS === '1';
if (testHooks) console.log('esbuild: CHR_TEST_HOOKS=1, building with e2e test hooks');

await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  // VS Code 1.95 (engines.vscode, UNK-016) ships Electron 32, which runs Node 20.
  target: 'node20',
  external: ['vscode'],
  // jsonc-parser's UMD build (its `main`) loads its own files with a dynamic `require` that esbuild
  // leaves unbundled, so the .vsix would miss them; its ESM build (`module`) bundles statically.
  mainFields: ['module', 'main'],
  define: { __CHR_TEST_HOOKS__: JSON.stringify(testHooks) },
  sourcemap: true,
  // Folds `if (false)` away so the hook code is not in release builds; names and whitespace stay.
  minifySyntax: true,
  logLevel: 'info',
});

await build({
  entryPoints: ['src/webview/placeholder.ts'],
  outfile: 'dist/webview.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  // Electron 32's Chromium 128.
  target: 'chrome128',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});
