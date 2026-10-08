// CustomTextEditorProvider for *.json, *.jsonc and *.json5 (spec 003 T3). The document stays a
// normal VS Code TextDocument; the webview only shows it. The webview runs scripts only with a
// per-render nonce and loads files only from the extension's dist folder (003 T4, criterion 6;
// see webviewHtml.ts). Document sync (003 T5) builds on this. Schema validation runs here in the
// host and reaches the webview as `validation` messages (004 T2, ADR-010; see validation.ts).
import * as vscode from 'vscode';
import type { SchemaError } from '@chr-json-editor/app-shell/protocol';
import { DocumentValidation, formatOfPath } from './validation';
import { createNonce, escapeHtml, renderWebviewHtml } from './webviewHtml';

export const VIEW_TYPE = 'chrJsonEditor.editor';

/** Replaced by esbuild (esbuild.mjs): true only in the e2e build, so release code never has hooks. */
declare const __CHR_TEST_HOOKS__: boolean;

/** What the e2e test reads about one resolved webview (test-hook builds only). */
export interface WebviewSnapshot {
  uri: string;
  html: string;
  cspSource: string;
  enableScripts: boolean;
  localResourceRoots: string[];
  scriptLoaded: boolean;
  /** Every `validation` message the webview script decoded, as it reported it back (004 T2). */
  validationsShown: ShownValidation[];
}

/** What the placeholder webview reports after decoding a `validation` message. */
export interface ShownValidation {
  docVersion: number;
  errors: SchemaError[] | null;
  reason: string | null;
}

export class JsonEditorProvider implements vscode.CustomTextEditorProvider {
  /** Filled only when `__CHR_TEST_HOOKS__` is true. */
  readonly snapshots = new Map<vscode.WebviewPanel, WebviewSnapshot>();
  /** One per open panel. 004 T5 sets each one's schema from the association rules. */
  readonly validations = new Map<vscode.WebviewPanel, DocumentValidation>();

  private constructor(private readonly extensionUri: vscode.Uri) {}

  static register(context: vscode.ExtensionContext): {
    provider: JsonEditorProvider;
    disposable: vscode.Disposable;
  } {
    const provider = new JsonEditorProvider(context.extensionUri);
    return {
      provider,
      disposable: vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider),
    };
  }

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const { webview } = panel;
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    webview.options = { enableScripts: true, localResourceRoots: [dist] };
    const name = document.uri.path.slice(document.uri.path.lastIndexOf('/') + 1);
    webview.html = renderWebviewHtml({
      cspSource: webview.cspSource,
      nonce: createNonce(),
      title: name,
      scripts: [webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js')).toString()],
      stylesheets: [],
      body: `<p>${escapeHtml(name)} is open in CHR JSON Editor. The tree, text and table views are
not built yet; use "Reopen as Text" to edit it.</p>`,
    });

    if (__CHR_TEST_HOOKS__) {
      const snapshot: WebviewSnapshot = {
        uri: document.uri.toString(),
        html: webview.html,
        cspSource: webview.cspSource,
        enableScripts: webview.options.enableScripts ?? false,
        localResourceRoots: (webview.options.localResourceRoots ?? []).map((u) => u.toString()),
        scriptLoaded: false,
        validationsShown: [],
      };
      this.snapshots.set(panel, snapshot);
      webview.onDidReceiveMessage((message: { type?: unknown } & Partial<ShownValidation>) => {
        if (message.type === 'placeholderLoaded') snapshot.scriptLoaded = true;
        if (message.type === 'validationShown') {
          snapshot.validationsShown.push({
            docVersion: message.docVersion ?? -1,
            errors: message.errors ?? null,
            reason: message.reason ?? null,
          });
        }
      });
      panel.onDidDispose(() => this.snapshots.delete(panel));
    }

    const validation = new DocumentValidation({
      snapshot: () => ({ text: document.getText(), docVersion: document.version }),
      format: formatOfPath(document.uri.path),
      post: (message) => void webview.postMessage(message),
    });
    this.validations.set(panel, validation);
    const changes = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === document && event.contentChanges.length > 0) validation.schedule();
    });
    panel.onDidDispose(() => {
      changes.dispose();
      validation.dispose();
      this.validations.delete(panel);
    });
  }
}
