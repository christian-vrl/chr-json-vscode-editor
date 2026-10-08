// Bundles the extension host code (001 T5): one CommonJS file for VS Code's Node runtime, with
// `vscode` left external because the editor provides it.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  // VS Code 1.95 (engines.vscode, UNK-016) ships Electron 32, which runs Node 20.
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  minify: false,
  logLevel: 'info',
});
