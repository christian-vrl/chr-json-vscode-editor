// Webview script until the app-shell bundle (003 T2) replaces it: bundled by esbuild into
// dist/webview.js and loaded with the CSP nonce. It tells the host it ran, which shows the nonce,
// `localResourceRoots` and `asWebviewUri` line up (the e2e test waits for it). Runs in the
// webview, not the extension host, so it must not import `vscode` or Node modules.
//
// 004 T2: it also decodes each host message with the real protocol decoder and reports every
// `validation` message back, so the e2e test can see schema errors arrive in the webview keyed by
// `docVersion` before 003 T5 wires the editor. The library's `validator` prop is 004 T5.
import { decodeToWebview } from '@chr-json-editor/app-shell/protocol';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
declare const window: {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
};

const vscode = acquireVsCodeApi();

window.addEventListener('message', (event) => {
  const decoded = decodeToWebview(event.data);
  if (!decoded.ok || decoded.message.type !== 'validation') return;
  const { docVersion, result } = decoded.message;
  vscode.postMessage({
    type: 'validationShown',
    docVersion,
    errors: result.kind === 'errors' ? result.errors : null,
    reason: result.kind === 'skipped' ? result.reason : null,
  });
});

vscode.postMessage({ type: 'placeholderLoaded' });
