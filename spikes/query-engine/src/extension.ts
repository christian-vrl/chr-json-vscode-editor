// Spike 011 T1 extension host side. Opens a document in a CustomTextEditorProvider whose webview
// gets 003 T4's options (enableScripts, localResourceRoots = dist only) and HTML rendered by the
// real `renderWebviewHtml` from packages/vscode-extension, with `'wasm-unsafe-eval'` added to
// `script-src` (spec 011 criterion 9) unless the run asks for 003's policy unchanged. The test
// (suite.cjs) sets what the next editor does and reads the page's messages through `activate`'s
// return value.
import * as vscode from 'vscode';
import {
  contentSecurityPolicy,
  createNonce,
  escapeHtml,
  renderWebviewHtml,
} from '../../../packages/vscode-extension/src/webviewHtml';
import type { Policy, StartMessage, Task } from './protocol';

export const VIEW_TYPE = 'chrJsonSpike.queryEngine';

/** 003 T4's page, with criterion 9's one change to its policy. */
export function spikeHtml(options: {
  cspSource: string;
  nonce: string;
  policy: Policy;
  script: string;
  stylesheets: string[];
}): string {
  const html = renderWebviewHtml({
    cspSource: options.cspSource,
    nonce: options.nonce,
    title: 'CHR JSON query-engine spike',
    scripts: [options.script],
    stylesheets: options.stylesheets,
  });
  if (options.policy === 'unchanged') return html;
  const policy = contentSecurityPolicy(options.cspSource, options.nonce);
  const scriptSrc = `script-src 'nonce-${options.nonce}'`;
  const changed = policy.replace(scriptSrc, `${scriptSrc} 'wasm-unsafe-eval'`);
  if (changed === policy || !html.includes(escapeHtml(policy)))
    throw new Error('the policy did not have the expected script-src');
  return html.replace(escapeHtml(policy), escapeHtml(changed));
}

export interface Session {
  /** Every message the page posted, in order. */
  messages: { type: string; [key: string]: unknown }[];
  /** Resolves with the next message of `type`. */
  next(type: string, timeoutMs: number): Promise<{ type: string; [key: string]: unknown }>;
  post(message: unknown): Thenable<boolean>;
  cspSource: string;
}

export interface SpikeApi {
  /** What the next resolved editor does. */
  prepare(policy: Policy, task: Task): void;
  /** The session of the last resolved editor. */
  session(): Promise<Session>;
}

export function activate(context: vscode.ExtensionContext): SpikeApi {
  let next: { policy: Policy; task: Task } | undefined;
  let resolveSession: ((session: Session) => void) | undefined;
  let current: Promise<Session> = new Promise((resolve) => (resolveSession = resolve));
  const dist = vscode.Uri.joinPath(context.extensionUri, 'dist');

  const provider: vscode.CustomTextEditorProvider = {
    resolveCustomTextEditor(document, panel) {
      if (!next) throw new Error('prepare() first');
      const { policy, task } = next;
      const { webview } = panel;
      webview.options = { enableScripts: true, localResourceRoots: [dist] };
      const uri = (name: string) =>
        webview.asWebviewUri(vscode.Uri.joinPath(dist, name)).toString();
      const usesLoader = task.kind === 'load' && task.route !== 'c';
      webview.html = spikeHtml({
        cspSource: webview.cspSource,
        nonce: createNonce(),
        policy,
        script: uri(usesLoader ? 'loader.js' : 'page.js'),
        stylesheets: usesLoader ? [] : [uri('page.css')],
      });

      const messages: Session['messages'] = [];
      const waiters: { type: string; resolve: (m: Session['messages'][number]) => void }[] = [];
      const session: Session = {
        messages,
        cspSource: webview.cspSource,
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
      };
      webview.onDidReceiveMessage((message: Session['messages'][number]) => {
        if (message.type === 'pageReady') {
          const start: StartMessage = {
            type: 'start',
            task,
            text: document.getText(),
            engineModuleUrl: uri('engine.mjs'),
            engineClassicUrl: uri('engine-classic.js'),
          };
          void webview.postMessage(start);
          return;
        }
        const waiter = waiters.findIndex((w) => w.type === message.type);
        if (waiter !== -1) waiters.splice(waiter, 1)[0]!.resolve(message);
        else messages.push(message);
      });
      resolveSession?.(session);
    },
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider));

  return {
    prepare(policy, task) {
      next = { policy, task };
      current = new Promise((resolve) => (resolveSession = resolve));
    },
    session: () => current,
  };
}

export function deactivate(): void {}
