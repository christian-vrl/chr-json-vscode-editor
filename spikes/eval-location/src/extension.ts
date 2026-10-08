// Spike 004 T1 extension host side. Opens the benchmark document in a CustomTextEditorProvider
// whose webview gets exactly 003 T4's options (enableScripts, localResourceRoots = dist only) and
// exactly 003 T4's CSP, built by the real `contentSecurityPolicy` from packages/vscode-extension;
// only the variants that need it add one `frame-src` directive. The test (suite.cjs) picks the
// variant before each open and reads the webview's ResultMessage through `activate`'s return value.
import * as vscode from 'vscode';
import {
  contentSecurityPolicy,
  createNonce,
  escapeHtml,
} from '../../../packages/vscode-extension/src/webviewHtml';
import { compile, describeError, run, type Compiled } from './ajv-runner';
import type { ResultMessage, StartMessage, Variant } from './protocol';

export const VIEW_TYPE = 'chrJsonSpike.evalLocation';

/** The 003 T4 policy, plus `frame-src` for the variants that load a child frame from a URL. */
export function policyFor(variant: Variant, cspSource: string, nonce: string): string {
  const base = contentSecurityPolicy(cspSource, nonce);
  if (variant === 'iframe-src' || variant === 'iframe-src-unsandboxed')
    return `${base}; frame-src ${cspSource}`;
  if (variant === 'iframe-blob') return `${base}; frame-src blob:`;
  return base;
}

export interface SpikeApi {
  /** The variant the next resolved editor uses. */
  setVariant(variant: Variant, schema: object): void;
  result(variant: Variant): Promise<ResultMessage & { cspSource: string }>;
}

export function activate(context: vscode.ExtensionContext): SpikeApi {
  let next: { variant: Variant; schema: object } | undefined;
  const waiting = new Map<Variant, (r: ResultMessage & { cspSource: string }) => void>();
  const done = new Map<Variant, ResultMessage & { cspSource: string }>();
  const dist = vscode.Uri.joinPath(context.extensionUri, 'dist');

  const provider: vscode.CustomTextEditorProvider = {
    resolveCustomTextEditor(document, panel) {
      if (!next) throw new Error('setVariant() first');
      const { variant, schema } = next;
      const { webview } = panel;
      webview.options = { enableScripts: true, localResourceRoots: [dist] };
      const nonce = createNonce();
      const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'page.js')).toString();
      webview.html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(policyFor(variant, webview.cspSource, nonce))}">
<title>eval-location spike: ${escapeHtml(variant)}</title>
</head>
<body>
<p>Spike 004 T1, variant ${escapeHtml(variant)}</p>
<script nonce="${escapeHtml(nonce)}" src="${escapeHtml(script)}"></script>
</body>
</html>
`;
      let hostCompiled: Compiled | undefined;
      webview.onDidReceiveMessage((message: { type: string; run?: number } | ResultMessage) => {
        if (message.type === 'pageReady') {
          const start: StartMessage = {
            type: 'start',
            variant,
            text: document.getText(),
            schema,
            sandboxUrl: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'sandbox.html')).toString(),
          };
          void webview.postMessage(start);
        } else if (message.type === 'hostValidate') {
          // Option B: what the host would do on a document change.
          try {
            const firstCompile = !hostCompiled;
            hostCompiled ??= compile(schema);
            const { errors, validateMs } = run(hostCompiled, JSON.parse(document.getText()));
            void webview.postMessage({
              type: 'hostErrors',
              compileMs: firstCompile ? hostCompiled.compileMs : null,
              validateMs,
              errors,
            });
          } catch (error) {
            void webview.postMessage({
              type: 'hostErrors',
              compileMs: null,
              validateMs: 0,
              errors: null,
              error: describeError(error),
            });
          }
        } else if (message.type === 'result') {
          const result = { ...(message as ResultMessage), cspSource: webview.cspSource };
          done.set(variant, result);
          waiting.get(variant)?.(result);
        }
      });
    },
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider));

  return {
    setVariant(variant, schema) {
      next = { variant, schema };
      done.delete(variant);
    },
    result(variant) {
      const ready = done.get(variant);
      if (ready) return Promise.resolve(ready);
      return new Promise((resolve) => waiting.set(variant, resolve));
    },
  };
}

export function deactivate(): void {}
