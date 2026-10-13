// Spike 015 T1 extension host side: a CustomTextEditorProvider whose webview gets 003 T4's options
// (enableScripts, localResourceRoots = dist only) and the HTML of the real `renderWebviewHtml` from
// packages/vscode-extension, unchanged (003's policy). suite.cjs drives each page through
// `activate`'s return value.
import * as vscode from 'vscode';
import { createNonce, renderWebviewHtml } from '../../../packages/vscode-extension/src/webviewHtml';

export const VIEW_TYPE = 'chrJsonSpike.losslessNumbers';

type Message = { type: string; [key: string]: unknown };

export interface Session {
  next(type: string, timeoutMs: number): Promise<Message>;
  post(message: unknown): Thenable<boolean>;
  documentText: string;
}

export interface SpikeApi {
  /** The session of the next resolved editor. */
  nextSession(): Promise<Session>;
}

export function activate(context: vscode.ExtensionContext): SpikeApi {
  let resolveSession: ((session: Session) => void) | undefined;
  const dist = vscode.Uri.joinPath(context.extensionUri, 'dist');

  const provider: vscode.CustomTextEditorProvider = {
    resolveCustomTextEditor(document, panel) {
      const { webview } = panel;
      webview.options = { enableScripts: true, localResourceRoots: [dist] };
      const uri = (name: string) =>
        webview.asWebviewUri(vscode.Uri.joinPath(dist, name)).toString();
      const messages: Message[] = [];
      const waiters: { type: string; resolve: (m: Message) => void }[] = [];
      webview.onDidReceiveMessage((message: Message) => {
        const waiter = waiters.findIndex((w) => w.type === message.type);
        if (waiter !== -1) waiters.splice(waiter, 1)[0]!.resolve(message);
        else messages.push(message);
      });
      webview.html = renderWebviewHtml({
        cspSource: webview.cspSource,
        nonce: createNonce(),
        title: 'CHR JSON lossless-numbers spike',
        scripts: [uri('page.js')],
        stylesheets: [uri('page.css')],
      });
      resolveSession?.({
        documentText: document.getText(),
        post: (message) => webview.postMessage(message),
        next(type, timeoutMs) {
          const seen = messages.findIndex((m) => m.type === type);
          if (seen !== -1) return Promise.resolve(messages.splice(seen, 1)[0]!);
          return new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`no ${type} within ${timeoutMs} ms`)),
              timeoutMs,
            );
            waiters.push({
              type,
              resolve: (m) => {
                clearTimeout(timer);
                resolve(m);
              },
            });
          });
        },
      });
    },
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider));
  return {
    nextSession: () => new Promise((resolve) => (resolveSession = resolve)),
  };
}

export function deactivate(): void {}
