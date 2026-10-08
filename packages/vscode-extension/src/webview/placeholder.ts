// Webview script until the app-shell bundle (003 T2) replaces it: bundled by esbuild into
// dist/webview.js and loaded with the CSP nonce. It only tells the host it ran, which shows the
// nonce, `localResourceRoots` and `asWebviewUri` line up (the e2e test waits for it). Runs in the
// webview, not the extension host, so it must not import `vscode` or Node modules.
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

acquireVsCodeApi().postMessage({ type: 'placeholderLoaded' });
