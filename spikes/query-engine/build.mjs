// Builds spike 011 T1 into dist/. Dev-only; nothing ships.
//   extension.js      the extension host side (CommonJS, `vscode` external)
//   page.js/.css      the editor page: vanilla-jsoneditor's Transform dialog with JavaScript and
//                     Lodash on the engine, the probes, the bench and the typing test. One classic
//                     minified esbuild script, the format of packages/vscode-extension's webview.js;
//                     the engine is inside it (R7 route c).
//   loader.js         a page without the engine, for R7 routes (a) and (b)
//   engine.mjs        the engine as an ES module, for route (a), a dynamic import()
//   engine-classic.js the engine as a classic script setting globalThis.chrQueryEngine, for route (b)
//   preflight.mjs     the Node preflight
//   node-reference.mjs the library's own executeQuery in Node (the reference)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import {
  extractInjectedCss,
  styleModPageNonce,
} from '../../packages/app-shell/vite-plugin-library-css.mts';

const require = createRequire(import.meta.url);
const lodashMin = readFileSync(require.resolve('lodash/lodash.min.js'), 'utf8');

/** `import lodashSource from 'lodash-source'`: Lodash's minified source as a string, evaluated
 *  only inside the engine (plan §Approach step 1). */
const lodashSourcePlugin = {
  name: 'lodash-source',
  setup(b) {
    b.onResolve({ filter: /^lodash-source$/ }, () => ({
      path: 'lodash-source',
      namespace: 'lodash-source',
    }));
    b.onLoad({ filter: /.*/, namespace: 'lodash-source' }, () => ({
      contents: `export default ${JSON.stringify(lodashMin)};`,
      loader: 'js',
    }));
  },
};

/** UNK-029, as app-shell's Vite plugin does it: the library's injected CSS goes to page.css, and
 *  style-mod takes the page's script nonce. */
let libraryCss = '';
const libraryCssPlugin = {
  name: 'library-css',
  setup(b) {
    b.onLoad({ filter: /[\\/]vanilla-jsoneditor[\\/]index\.js$/ }, (args) => {
      const { code, extracted } = extractInjectedCss(readFileSync(args.path, 'utf8'));
      libraryCss = extracted.css.join('\n');
      return { contents: code, loader: 'js' };
    });
    b.onLoad({ filter: /[\\/]style-mod[\\/]src[\\/]style-mod\.js$/ }, (args) => ({
      contents: styleModPageNonce(readFileSync(args.path, 'utf8')),
      loader: 'js',
    }));
  },
};

const common = {
  bundle: true,
  logLevel: 'warning',
  sourcemap: false,
  plugins: [lodashSourcePlugin, libraryCssPlugin],
};
// packages/vscode-extension/esbuild.mjs's webview settings.
const webview = {
  ...common,
  format: 'iife',
  platform: 'browser',
  target: 'chrome128',
  minify: true,
};

await build({
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  mainFields: ['module', 'main'],
});
await build({ ...webview, entryPoints: ['src/page.ts'], outfile: 'dist/page.js' });
writeFileSync('dist/page.css', `${libraryCss}\n`);
await build({ ...webview, entryPoints: ['src/loader.ts'], outfile: 'dist/loader.js' });
await build({
  ...webview,
  format: 'esm',
  entryPoints: ['src/engine.ts'],
  outfile: 'dist/engine.mjs',
});
await build({
  ...webview,
  entryPoints: ['src/engine.ts'],
  outfile: 'dist/engine-classic.js',
  globalName: 'chrQueryEngine',
});
await build({
  ...common,
  entryPoints: ['src/preflight.ts'],
  outfile: 'dist/preflight.mjs',
  format: 'esm',
  platform: 'node',
  target: 'node22',
});
await build({
  ...common,
  entryPoints: ['src/node-reference.ts'],
  outfile: 'dist/node-reference.mjs',
  format: 'esm',
  platform: 'node',
  target: 'node22',
});
console.log('spike built into dist/');
