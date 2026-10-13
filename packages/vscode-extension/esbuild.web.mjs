// esbuild options for the browser entry (spec 013 T1, ADR-013), shared by esbuild.mjs and the unit
// test that checks the bundle (test/unit/webEntry.test.ts). One CommonJS file, as the Node entry,
// which VS Code's web worker extension host loads with only `vscode` to `require`.
import { fileURLToPath } from 'node:url';

/**
 * @param {{ testHooks: boolean, outfile?: string }} options
 * @returns {import('esbuild').BuildOptions}
 */
export function browserEntryOptions({ testHooks, outfile = 'dist/web/extension.js' }) {
  return {
    absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
    entryPoints: ['src/web/extension.ts'],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    // The web host runs in the browser tab's Chromium: VS Code desktop's (Electron 32's 128) or a
    // newer browser on vscode.dev, as the webview target in esbuild.mjs.
    target: 'chrome128',
    external: ['vscode'],
    // As in esbuild.mjs, jsonc-parser's ESM build; `browser` first, as for any browser bundle.
    mainFields: ['browser', 'module', 'main'],
    define: { __CHR_TEST_HOOKS__: JSON.stringify(testHooks) },
    sourcemap: true,
    sourcesContent: false,
    minifySyntax: true,
    logLevel: 'info',
  };
}
