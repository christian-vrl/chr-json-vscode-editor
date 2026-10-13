// Bundles the extension host code (001 T5): one CommonJS file for VS Code's Node runtime, with
// `vscode` left external because the editor provides it, and the same code again for the web worker
// extension host of vscode.dev and github.dev (spec 013 T1, esbuild.web.mjs). Also bundles the
// webview script (003 T5).
//
// CHR_TEST_HOOKS=1 builds the e2e variant (spec 003 §Acceptance criterion: the test-only hook is
// compiled out of release builds): `__CHR_TEST_HOOKS__` becomes true and `activate` returns
// `testHooks`. Without it the hook code is removed as dead code.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { browserEntryOptions } from './esbuild.web.mjs';

const testHooks = process.env.CHR_TEST_HOOKS === '1';
if (testHooks) console.log('esbuild: CHR_TEST_HOOKS=1, building with e2e test hooks');

await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  // Node 20 is the floor UNK-016 started from (VS Code 1.95, Electron 32); the resolved floor 1.136
  // runs a newer Node, so this target is conservative, not required.
  target: 'node20',
  external: ['vscode'],
  // jsonc-parser's UMD build (its `main`) loads its own files with a dynamic `require` that esbuild
  // leaves unbundled, so the .vsix would miss them; its ESM build (`module`) bundles statically.
  mainFields: ['module', 'main'],
  define: { __CHR_TEST_HOOKS__: JSON.stringify(testHooks) },
  sourcemap: true,
  // The map points at the sources instead of embedding them, so the comments in bundled
  // dependencies (Ajv's links to RFCs) do not land in dist/ for check:offline (004 T2). The map
  // is a dev aid and never ships (.vscodeignore).
  sourcesContent: false,
  // Folds `if (false)` away so the hook code is not in release builds; names and whitespace stay.
  minifySyntax: true,
  logLevel: 'info',
});

// The browser entry (spec 013 T1): dist/web/extension.js, the manifest's `browser`.
await build(browserEntryOptions({ testHooks }));

// The webview script (003 T5): app-shell's library build (dist/lib, Svelte and vanilla-jsoneditor
// included) under a VscodeHostAdapter. One classic script, so the page loads it with the nonce like
// any other; the CSS it imports (the editor's, with the library's moved out of JavaScript by
// UNK-029's Vite plugin) goes to dist/webview.css, loaded from the webview source.
// The compare panel's script (007 T4, src/webview/compareMain.ts) is built the same way into
// dist/compare.js and dist/compare.css, and the CSV panel's (009 T4, src/webview/csvMain.ts) into
// dist/csv.js and dist/csv.css.
await build({
  entryPoints: {
    webview: 'src/webview/main.ts',
    compare: 'src/webview/compareMain.ts',
    csv: 'src/webview/csvMain.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  // Electron 32's Chromium 128.
  target: 'chrome128',
  define: { __CHR_TEST_HOOKS__: JSON.stringify(testHooks) },
  // Minified (003 T11 benchmark carry-forward): the bundle holds Svelte, vanilla-jsoneditor and
  // CodeMirror, 1.5 MB as written and 0.94 MB minified. Also folds the test hooks away in release
  // builds, as for the extension host. (Open time at 1 MiB did not measurably change: PR #37.)
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

// The JavaScript and Lodash query engine (spec 011 T5): app-shell's dist/lib/engine.js and the
// chunks it imports (QuickJS's single-file WebAssembly module, its loader and FFI) go to
// dist/engine/ as they are, ES modules the editor webview loads with `import()` by their webview
// URI when the Transform dialog first opens (011 T1 REPORT §3 route (a); src/webview/main.ts).
// They are not bundled into webview.js, so opening a document does not parse them (criterion 10).
const lib = path.dirname(createRequire(import.meta.url).resolve('@chr-json-editor/app-shell/ui'));
const engineDir = 'dist/engine';
rmSync(engineDir, { recursive: true, force: true });
mkdirSync(engineDir, { recursive: true });
const engineFiles = new Set();
const copyModule = (file) => {
  if (engineFiles.has(file)) return;
  engineFiles.add(file);
  const source = readFileSync(path.join(lib, file), 'utf8');
  copyFileSync(path.join(lib, file), path.join(engineDir, file));
  // Vite's ES output names its chunks with static `from"./x.js"` and dynamic `import("./x.js")`.
  for (const [, chunk] of source.matchAll(/(?:from|import\(?)\s*["']\.\/([^"'/]+\.js)["']/g)) {
    copyModule(chunk);
  }
};
copyModule('engine.js');
console.log(`esbuild: query engine copied to ${engineDir}: ${[...engineFiles].join(', ')}`);
