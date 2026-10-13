// Builds spike 015 T1 into dist/. Dev-only; nothing ships.
//   extension.js    the extension host side (CommonJS, `vscode` external)
//   page.js/.css    the editor page: vanilla-jsoneditor 3.13.0 with the lossless parser, the probes
//                   and the bench. One classic minified esbuild script, the format of
//                   packages/vscode-extension's webview.js, with the library's injected CSS moved
//                   to page.css (UNK-029) as app-shell's Vite plugin does.
//   node-bench.mjs  the same bench in Node, for reference
import { readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import {
  extractInjectedCss,
  styleModPageNonce,
} from '../../packages/app-shell/vite-plugin-library-css.mts';

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

const common = { bundle: true, logLevel: 'warning', sourcemap: false };

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
await build({
  ...common,
  plugins: [libraryCssPlugin],
  entryPoints: ['src/page.ts'],
  outfile: 'dist/page.js',
  format: 'iife',
  platform: 'browser',
  target: 'chrome128',
  minify: true,
});
writeFileSync('dist/page.css', `${libraryCss}\n`);
await build({
  ...common,
  entryPoints: ['src/node-bench.ts'],
  outfile: 'dist/node-bench.mjs',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // jsonc-parser's UMD build needs `require`; its ES module build does not.
  mainFields: ['module', 'main'],
});
