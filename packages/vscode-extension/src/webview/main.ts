// Webview script (003 T5): the app-shell editor UI over a VscodeHostAdapter. esbuild bundles it with
// app-shell's library build into dist/webview.js and the CSS it imports into dist/webview.css; the
// page loads both from the webview source with the CSP nonce (webviewHtml.ts, criterion 6). Runs
// in the webview, not the extension host, so it must not import `vscode` or Node modules.
import '@chr-json-editor/app-shell/page.css';
import '@chr-json-editor/app-shell/ui.css';
import { mountApp, type AppHandle, type QueryEngineModule } from '@chr-json-editor/app-shell/ui';
import { installTestHooks } from './testHooks';
import { VscodeHostAdapter } from './vscodeHostAdapter';

/** Replaced by esbuild (esbuild.mjs): true only in the e2e build, so release code never has hooks. */
declare const __CHR_TEST_HOOKS__: boolean;
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();
const listeners = new Set<(data: unknown) => void>();
let app: AppHandle | undefined;
const consume: (data: unknown) => boolean = __CHR_TEST_HOOKS__
  ? installTestHooks(vscode, () => app)
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
// The JavaScript and Lodash query engine (spec 011 T5): an ES module next to this script, whose
// webview URI the extension puts on #app. `import()` from this nonce'd script inherits the nonce, so
// the CSP allows it (011 T1 REPORT §3 route (a)); nothing loads it before Transform first opens.
const engineUrl = target?.dataset.queryEngine;
const loadQueryEngine = engineUrl
  ? () => import(engineUrl) as Promise<QueryEngineModule>
  : undefined;
if (target) app = mountApp(target, host, { loadQueryEngine });
