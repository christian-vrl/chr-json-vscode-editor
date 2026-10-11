// The compare panel's webview script (007 T4): app-shell's compare page over a
// VscodeCompareHostAdapter. esbuild bundles it with app-shell's library build into dist/compare.js
// and the CSS it imports into dist/compare.css; the page loads both from the webview source with the
// CSP nonce (webviewHtml.ts, spec 007 criterion 9). Runs in the webview, not the extension host, so
// it must not import `vscode` or Node modules.
import '@chr-json-editor/app-shell/page.css';
import '@chr-json-editor/app-shell/ui.css';
import { mountCompare, parseCompareText } from '@chr-json-editor/app-shell/compare';
import { installCompareTestHooks } from './compareTestHooks';
import { VscodeCompareHostAdapter } from './vscodeCompareHostAdapter';

/** Replaced by esbuild (esbuild.mjs): true only in the e2e build, so release code never has hooks. */
declare const __CHR_TEST_HOOKS__: boolean;
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();
const listeners = new Set<(data: unknown) => void>();
const consume: (data: unknown) => boolean = __CHR_TEST_HOOKS__
  ? installCompareTestHooks(vscode)
  : () => false;

window.addEventListener('message', (event: MessageEvent) => {
  if (consume(event.data)) return;
  for (const listener of [...listeners]) listener(event.data);
});

const host = new VscodeCompareHostAdapter(
  vscode,
  (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  parseCompareText,
);
const target = document.getElementById('app');
if (target) mountCompare(target, host);
