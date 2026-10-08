// CustomTextEditorProvider for *.json, *.jsonc and *.json5 (spec 003 T3). The document stays a
// normal VS Code TextDocument; the webview only shows it. The webview runs scripts only with a
// per-render nonce and loads files only from the extension's dist folder (003 T4, criterion 6;
// see webviewHtml.ts). Each tab reports to the status-bar format badge (003 T10). Document sync
// (003 T5) builds on this.
import * as vscode from 'vscode';
import type { FormatBadgeController } from './formatBadgeVscode';
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
}

export class JsonEditorProvider implements vscode.CustomTextEditorProvider {
  /** Filled only when `__CHR_TEST_HOOKS__` is true. */
  readonly snapshots = new Map<vscode.WebviewPanel, WebviewSnapshot>();

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly formatBadge: FormatBadgeController | undefined,
  ) {}

  static register(
    context: vscode.ExtensionContext,
    formatBadge: FormatBadgeController | undefined,
  ): {
    provider: JsonEditorProvider;
    disposable: vscode.Disposable;
  } {
    const provider = new JsonEditorProvider(context.extensionUri, formatBadge);
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
    this.formatBadge?.track(document, panel);

    if (__CHR_TEST_HOOKS__) {
      const snapshot: WebviewSnapshot = {
        uri: document.uri.toString(),
        html: webview.html,
        cspSource: webview.cspSource,
        enableScripts: webview.options.enableScripts ?? false,
        localResourceRoots: (webview.options.localResourceRoots ?? []).map((u) => u.toString()),
        scriptLoaded: false,
      };
      this.snapshots.set(panel, snapshot);
      webview.onDidReceiveMessage((message: { type?: unknown }) => {
        if (message.type === 'placeholderLoaded') snapshot.scriptLoaded = true;
      });
      panel.onDidDispose(() => this.snapshots.delete(panel));
    }
  }
}
