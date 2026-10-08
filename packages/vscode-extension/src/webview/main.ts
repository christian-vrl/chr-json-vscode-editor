// Webview script (003 T5): the app-shell editor UI over a VscodeHostAdapter. esbuild bundles it with
// app-shell's library build into dist/webview.js and the CSS it imports into dist/webview.css; the
// page loads both from the webview source with the CSP nonce (webviewHtml.ts, criterion 6). Runs
// in the webview, not the extension host, so it must not import `vscode` or Node modules.
import '@chr-json-editor/app-shell/page.css';
import '@chr-json-editor/app-shell/ui.css';
import { mountApp } from '@chr-json-editor/app-shell/ui';
import { installTestHooks } from './testHooks';
import { VscodeHostAdapter } from './vscodeHostAdapter';

/** Replaced by esbuild (esbuild.mjs): true only in the e2e build, so release code never has hooks. */
declare const __CHR_TEST_HOOKS__: boolean;
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();
const listeners = new Set<(data: unknown) => void>();
const consume: (data: unknown) => boolean = __CHR_TEST_HOOKS__
  ? installTestHooks(vscode)
  : () => false;

window.addEventListener('message', (event: MessageEvent) => {
  if (consume(event.data)) return;
  for (const listener of [...listeners]) listener(event.data);
});

const host = new VscodeHostAdapter(vscode, (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
});
const target = document.getElementById('app');
if (target) mountApp(target, host);
