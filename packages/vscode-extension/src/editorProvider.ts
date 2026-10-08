// CustomTextEditorProvider for *.json, *.jsonc and *.json5 (spec 003 T3). The document stays a
// normal VS Code TextDocument; the webview shows it in app-shell's editor (003 T5, webview/main.ts).
// The webview runs scripts only with a per-render nonce and loads files only from the extension's
// dist folder (003 T4, criterion 6; see webviewHtml.ts). Each tab reports to the status-bar format
// badge (003 T10). Schema validation runs here in the host and reaches the webview as `validation`
// messages (004 T2, ADR-010; see validation.ts).
//
// The webview speaks app-shell's message protocol. It sends `ready` once its script listens; only
// then does the host post `init`, the latest validation result, and an `update` for each later
// change of the document, so nothing is posted into a page that cannot receive it yet. Edits from
// the webview reach the document through DocumentSync (documentSync.ts, 003 T5).
import * as vscode from 'vscode';
import {
  decodeToHost,
  PROTOCOL_VERSION,
  type Format,
  type Mode,
  type SchemaError,
  type ToHostMessage,
  type ToWebviewMessage,
} from '@chr-json-editor/app-shell/protocol';
import { detect } from '@chr-json-editor/core';
import { DocumentSync, minimalReplacement } from './documentSync';
import type { FormatBadgeController } from './formatBadgeVscode';
import type { RenderedProbe } from './testProbe';
import { DocumentValidation } from './validation';
import { createNonce, renderWebviewHtml } from './webviewHtml';

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
  /** The webview script sent `ready`: the nonce, `localResourceRoots` and `asWebviewUri` line up. */
  scriptLoaded: boolean;
  /** Every `validation` message the webview script decoded, as it reported it back (004 T2). */
  validationsShown: ShownValidation[];
  /** How many `edit` messages the webview sent (criterion 2: none for an external change). */
  editsReceived: number;
}

/** What the webview reports after decoding a `validation` message. */
export interface ShownValidation {
  docVersion: number;
  errors: SchemaError[] | null;
  reason: string | null;
}

/** One open editor tab: its document, webview and validation. */
interface Session {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  validation: DocumentValidation;
  sync: DocumentSync;
  /** Whether the webview sent `ready`; until then the host posts nothing. */
  ready: boolean;
}

export class JsonEditorProvider implements vscode.CustomTextEditorProvider {
  /** Filled only when `__CHR_TEST_HOOKS__` is true. */
  readonly snapshots = new Map<vscode.WebviewPanel, WebviewSnapshot>();
  /** One per open panel. 004 T5 sets each one's schema from the association rules. */
  readonly validations = new Map<vscode.WebviewPanel, DocumentValidation>();
  private readonly sessions = new Map<vscode.WebviewPanel, Session>();
  /** Test hooks: probes waiting for the webview's answer, by id. */
  private readonly probes = new Map<number, (result: RenderedProbe) => void>();
  private nextProbe = 1;
  /** Test hooks: `whenShown` calls waiting for the webview to render their text, by id. */
  private readonly shownWaiters = new Map<number, () => void>();

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly formatBadge: FormatBadgeController,
  ) {}

  static register(
    context: vscode.ExtensionContext,
    formatBadge: FormatBadgeController,
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
      stylesheets: [webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css')).toString()],
      body: '<main id="app"></main>',
    });
    this.formatBadge.track(document, panel);

    const session: Session = {
      document,
      panel,
      ready: false,
      validation: new DocumentValidation({
        snapshot: () => ({ text: document.getText(), docVersion: document.version }),
        // The format at open time; 004 T5 follows a switch made from the format badge (003 T10).
        format: detect(document.uri.path, document.languageId, document.getText()).format,
        post: (message) => this.post(session, message),
      }),
      sync: new DocumentSync({
        text: () => document.getText(),
        version: () => document.version,
        format: () => this.formatOf(document),
        replace: (text) => {
          const { start, end, text: replacement } = minimalReplacement(document.getText(), text);
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(start), document.positionAt(end)),
            replacement,
          );
          return Promise.resolve(vscode.workspace.applyEdit(edit));
        },
        post: (message) => this.post(session, message),
      }),
    };
    this.sessions.set(panel, session);
    this.validations.set(panel, session.validation);

    let snapshot: WebviewSnapshot | undefined;
    if (__CHR_TEST_HOOKS__) {
      snapshot = {
        uri: document.uri.toString(),
        html: webview.html,
        cspSource: webview.cspSource,
        enableScripts: webview.options.enableScripts ?? false,
        localResourceRoots: (webview.options.localResourceRoots ?? []).map((u) => u.toString()),
        scriptLoaded: false,
        validationsShown: [],
        editsReceived: 0,
      };
      this.snapshots.set(panel, snapshot);
    }

    const received = webview.onDidReceiveMessage((data: unknown) => {
      if (__CHR_TEST_HOOKS__ && snapshot && this.receiveTestMessage(snapshot, data)) return;
      const decoded = decodeToHost(data);
      if (!decoded.ok) {
        console.error(`CHR JSON Editor: dropped a webview message: ${decoded.error}`);
        return;
      }
      if (__CHR_TEST_HOOKS__ && snapshot && decoded.message.type === 'ready') {
        snapshot.scriptLoaded = true;
      }
      this.receive(session, decoded.message);
    });
    const changes = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document !== document || event.contentChanges.length === 0) return;
      session.sync.changed();
      session.validation.schedule();
    });
    panel.onDidDispose(() => {
      received.dispose();
      changes.dispose();
      session.validation.dispose();
      this.sessions.delete(panel);
      this.validations.delete(panel);
      this.snapshots.delete(panel);
    });
  }

  private receive(session: Session, message: ToHostMessage): void {
    const { document } = session;
    switch (message.type) {
      case 'ready':
        // A reloaded webview sends `ready` again and gets the document afresh.
        session.ready = true;
        this.post(session, {
          protocol: PROTOCOL_VERSION,
          type: 'init',
          docVersion: document.version,
          text: document.getText(),
          format: this.formatOf(document),
          mode: 'tree',
          settings: {},
        });
        session.validation.run();
        return;
      case 'edit':
        if (__CHR_TEST_HOOKS__) this.snapshots.get(session.panel)!.editsReceived++;
        void session.sync.edit(message);
        return;
      case 'error':
        void vscode.window.showErrorMessage(`CHR JSON Editor: ${message.message}`);
        return;
    }
  }

  /** The format the badge holds for the document: detected, or chosen by the user. */
  private formatOf(document: vscode.TextDocument): Format {
    return (
      this.formatBadge.format(document) ??
      detect(document.uri.path, document.languageId, document.getText()).format
    );
  }

  /** Called by the format badge when the user picks a format: the webviews parse again (criterion 8). */
  formatChanged(document: vscode.TextDocument, format: Format): void {
    for (const session of this.sessions.values()) {
      if (session.document !== document) continue;
      this.post(session, {
        protocol: PROTOCOL_VERSION,
        type: 'setFormat',
        docVersion: document.version,
        format,
      });
    }
  }

  private post(session: Session, message: ToWebviewMessage): void {
    if (session.ready) void session.panel.webview.postMessage(message);
  }

  /** Test hooks: handles the webview's answers to probes and its validation reports. */
  private receiveTestMessage(snapshot: WebviewSnapshot, data: unknown): boolean {
    const message = data as { chrTest?: unknown; id?: unknown; result?: unknown };
    if (typeof message !== 'object' || message === null || !('chrTest' in message)) return false;
    if (message.chrTest === 'probe' && typeof message.id === 'number') {
      this.probes.get(message.id)?.(message.result as RenderedProbe);
      this.probes.delete(message.id);
    }
    if (message.chrTest === 'shown' && typeof message.id === 'number') {
      this.shownWaiters.get(message.id)?.();
      this.shownWaiters.delete(message.id);
    }
    if (message.chrTest === 'validationShown') {
      const shown = data as Partial<ShownValidation>;
      snapshot.validationsShown.push({
        docVersion: shown.docVersion ?? -1,
        errors: shown.errors ?? null,
        reason: shown.reason ?? null,
      });
    }
    return true;
  }

  private sessionFor(uri: string): Session | undefined {
    return [...this.sessions.values()].find((s) => s.document.uri.toString() === uri);
  }

  /** Test hook: asks the webview of `uri` what it renders. */
  probe(uri: string): Promise<RenderedProbe> {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const session = this.sessionFor(uri);
    if (!session) return Promise.reject(new Error(`no CHR JSON Editor shows ${uri}`));
    const id = this.nextProbe++;
    return new Promise((resolve) => {
      this.probes.set(id, resolve);
      void session.panel.webview.postMessage({ chrTest: 'probe', id });
    });
  }

  /** Test hook: resolves once the webview of `uri` renders `text` (003 T11 benchmark). */
  whenShown(uri: string, text: string): Promise<void> {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const session = this.sessionFor(uri);
    if (!session) return Promise.reject(new Error(`no CHR JSON Editor shows ${uri}`));
    const id = this.nextProbe++;
    return new Promise((resolve) => {
      this.shownWaiters.set(id, resolve);
      void session.panel.webview.postMessage({ chrTest: 'whenShown', id, text });
    });
  }

  /** Test hook: has the webview of `uri` send `patch` as a tree edit would (criterion 1). */
  patch(uri: string, patch: unknown): boolean {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const session = this.sessionFor(uri);
    if (!session) return false;
    void session.panel.webview.postMessage({ chrTest: 'patch', patch });
    return true;
  }

  /** Test hook: has the host switch the webview of `uri` to `mode` (the `setMode` message). */
  setMode(uri: string, mode: Mode): boolean {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const session = this.sessionFor(uri);
    if (!session) return false;
    this.post(session, {
      protocol: PROTOCOL_VERSION,
      type: 'setMode',
      docVersion: session.document.version,
      mode,
    });
    return true;
  }
}
