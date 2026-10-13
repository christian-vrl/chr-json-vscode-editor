// The CSV panel's webview script (009 T4): app-shell's CSV page over a VscodeCsvHostAdapter.
// esbuild bundles it with app-shell's library build into dist/csv.js and the CSS it imports into
// dist/csv.css; the page loads both from the webview source with the CSP nonce (webviewHtml.ts,
// spec 009 criterion 9). Runs in the webview, not the extension host, so it must not import
// `vscode` or Node modules.
import '@chr-json-editor/app-shell/page.css';
import '@chr-json-editor/app-shell/ui.css';
import { mountCsv } from '@chr-json-editor/app-shell/csv';
import { installCsvTestHooks } from './csvTestHooks';
import { VscodeCsvHostAdapter } from './vscodeCsvHostAdapter';

/** Replaced by esbuild (esbuild.mjs): true only in the e2e build, so release code never has hooks. */
declare const __CHR_TEST_HOOKS__: boolean;
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();
const listeners = new Set<(data: unknown) => void>();
const consume: (data: unknown) => boolean = __CHR_TEST_HOOKS__
  ? installCsvTestHooks(vscode)
  : () => false;

window.addEventListener('message', (event: MessageEvent) => {
  if (consume(event.data)) return;
  for (const listener of [...listeners]) listener(event.data);
});

const host = new VscodeCsvHostAdapter(vscode, (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
});
const target = document.getElementById('app');
if (target) mountCsv(target, host);
