// CustomTextEditorProvider for *.json, *.jsonc and *.json5 (spec 003 T3). The document stays a
// normal VS Code TextDocument; the webview shows it in app-shell's editor (003 T5, webview/main.ts).
// The webview runs scripts only with a per-render nonce and loads files only from the extension's
// dist folder (003 T4, criterion 6; see webviewHtml.ts). Each tab reports to the status-bar format
// badge (003 T10). Schema validation runs here in the host and reaches the webview as `validation`
// messages (004 T2, ADR-010; see validation.ts); which schema applies follows spec 004's
// association rules (004 T5, schemaBinding.ts), and the webview shows the errors inline.
//
// The webview speaks app-shell's message protocol. It sends `ready` once its script listens; only
// then does the host post `init`, the latest validation result, and an `update` for each later
// change of the document, so nothing is posted into a page that cannot receive it yet. Edits from
// the webview reach the document through DocumentSync (documentSync.ts, 003 T5).
//
// Undo, redo and save stay VS Code's (003 T7, spec 003 criterion 3): the webview's undo and redo
// keys and buttons send `undo` and `redo`, which run VS Code's own commands on the document's undo
// stack, and before VS Code saves the document the webview is asked to `flush` the typing it holds.
//
// Large-file mode (spec 008 T3): a tab whose document text is above 5 MiB in UTF-8 when it opens
// is a large-file tab for its whole life (criterion 1), and starts locked: `init` says so, the host
// answers any `edit` with the `read-only` error and ignores undo and redo from it (plan R3), and
// the format badge, validation and `$schema` read the text with core's data-only parse
// (largeFile.ts, criterion 8). "Edit anyway" (`unlock`) puts the tab on the normal path until it
// closes, kept here so a reloaded webview gets it back; "Open as Text" (`openAsText`) runs
// "Reopen as Text" on the document.
import * as vscode from 'vscode';
import {
  decodeToHost,
  PROTOCOL_VERSION,
  type Format,
  type LargeFile,
  type Mode,
  type SchemaError,
  type ToHostMessage,
  type ToWebviewMessage,
  type ValidationMessage,
} from '@chr-json-editor/app-shell/protocol';
import { detect, releaseParse } from '@chr-json-editor/core';
import { confirmRepair } from './confirm';
import { DocumentSync, minimalReplacement } from './documentSync';
import { largeFileFor, READ_ONLY_MESSAGE } from './largeFile';
import { parseToRelease } from './parseRelease';
import type { FormatBadgeController } from './formatBadgeVscode';
import { SchemaBinding } from './schemaBinding';
import { collectSchemaScopes } from './schemaSettings';
import { vscodeSchemaWorkspace } from './schemaSettingsVscode';
import type { DomStep, RenderedProbe } from './testProbe';
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
  /** How many times it sent `ready`: once more each time the webview reloads. */
  readies: number;
  /** Every `validation` message the webview script decoded, as it reported it back (004 T2). */
  validationsShown: ShownValidation[];
  /** How many `edit` messages the webview sent (criterion 2: none for an external change). */
  editsReceived: number;
  /** How many `flush` requests the host posted before a save (003 T7). */
  flushRequests: number;
  /** The tab's large-file state now, as `init` sends it (spec 008); null for the normal editor. */
  largeFile: LargeFile | null;
  /** `edit` messages refused because the tab is locked (spec 008 criterion 2, plan R3). */
  readOnlyRefusals: number;
  /** `undo` and `redo` messages ignored because the tab is locked. */
  historyIgnored: number;
}

/** What the webview reports after decoding a `validation` message. */
export interface ShownValidation {
  docVersion: number;
  errors: SchemaError[] | null;
  reason: string | null;
  dialect: ValidationMessage['dialect'];
}

/** One open editor tab: its document, webview and validation. */
interface Session {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  validation: DocumentValidation;
  schema: SchemaBinding;
  sync: DocumentSync;
  /** Whether the webview sent `ready`; until then the host posts nothing. */
  ready: boolean;
  /** `flush` requests waiting for the webview's `flushed`, by request number (003 T7). */
  flushes: Map<number, () => void>;
  /** Large-file mode, chosen when the tab opened (spec 008); null for the normal editor. */
  largeFile: LargeFile | null;
}

/** A large-file tab the user has not chosen "Edit anyway" for. */
function isLocked(session: { largeFile: LargeFile | null }): boolean {
  return session.largeFile !== null && !session.largeFile.unlocked;
}

/**
 * How long a save waits for the webview's `flushed` before it goes ahead without it (003 T7). The
 * webview answers once its last edit is applied, normally within milliseconds; a webview that is
 * gone, or a window whose timers Chromium throttles (a hidden window aligns them to whole seconds),
 * must not hold the save up for long.
 */
const FLUSH_TIMEOUT_MS = 1500;
let nextFlush = 1;

export class JsonEditorProvider implements vscode.CustomTextEditorProvider {
  /** Filled only when `__CHR_TEST_HOOKS__` is true. */
  readonly snapshots = new Map<vscode.WebviewPanel, WebviewSnapshot>();
  /** One per open panel; its schema comes from the association rules (`Session.schema`). */
  readonly validations = new Map<vscode.WebviewPanel, DocumentValidation>();
  private readonly sessions = new Map<vscode.WebviewPanel, Session>();
  /** Test hooks: probes and typing waiting for the webview's answer, by id. */
  private readonly probes = new Map<number, (result: unknown) => void>();
  private nextProbe = 1;
  /** Test hooks: `whenShown` and `whenSettled` calls waiting for the webview's answer, by id. */
  private readonly shownWaiters = new Map<number, (ms: number | undefined) => void>();

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
    // Measured once: the mode stays whatever later edits do to the size (criterion 1).
    const largeFile = largeFileFor(document.getText());
    const locked = () => isLocked(session);

    const validation = new DocumentValidation({
      snapshot: () => ({ text: document.getText(), docVersion: document.version }),
      format: () => this.formatOf(document),
      dataOnly: locked,
      post: (message) => this.post(session, message),
    });
    const schema = new SchemaBinding(
      {
        documentUri: () => document.uri.toString(true),
        text: () => document.getText(),
        format: () => this.formatOf(document),
        dataOnly: locked,
        settings: () => {
          const workspace = vscodeSchemaWorkspace();
          return {
            jsonSchemas: collectSchemaScopes('json', workspace),
            json5Schemas: collectSchemaScopes('json5', workspace),
          };
        },
        readFile: readSchemaFile,
      },
      validation,
    );
    const session: Session = {
      document,
      panel,
      ready: false,
      flushes: new Map(),
      largeFile,
      validation,
      schema,
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
        history: async (action) => {
          // VS Code's undo and redo act on the active editor; the webview asks only from its own
          // keys and buttons, so the panel is active unless the user moved on meanwhile.
          if (!panel.active) return;
          try {
            await vscode.commands.executeCommand(action);
          } catch (error) {
            console.error(`CHR JSON Editor: ${action} failed: ${String(error)}`);
          }
        },
        post: (message) => this.post(session, message),
        confirmRepair,
      }),
    };
    this.sessions.set(panel, session);
    this.validations.set(panel, session.validation);
    this.formatBadge.track(document, panel, locked);
    // Before the webview is ready, so the first `validation` goes out with the `ready` answer.
    void session.schema.refresh();

    let snapshot: WebviewSnapshot | undefined;
    if (__CHR_TEST_HOOKS__) {
      snapshot = {
        uri: document.uri.toString(),
        html: webview.html,
        cspSource: webview.cspSource,
        enableScripts: webview.options.enableScripts ?? false,
        localResourceRoots: (webview.options.localResourceRoots ?? []).map((u) => u.toString()),
        scriptLoaded: false,
        readies: 0,
        validationsShown: [],
        editsReceived: 0,
        flushRequests: 0,
        largeFile,
        readOnlyRefusals: 0,
        historyIgnored: 0,
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
        snapshot.readies++;
      }
      this.receive(session, decoded.message);
    });
    const changes = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length === 0) return;
      if (event.document === document) {
        session.sync.changed();
        session.validation.schedule();
        // The top-level `$schema` may have changed.
        session.schema.schedule();
      } else if (event.document.uri.toString(true) === session.schema.schemaFile) {
        session.schema.schedule(true);
      }
    });
    const saving = vscode.workspace.onWillSaveTextDocument((event) => {
      // Not for a hidden panel: its webview is gone until the panel shows again (no
      // `retainContextWhenHidden`), and text mode reported its typing when it lost focus, so
      // nothing would answer and the save (Save All, auto save of a background tab) would only
      // wait FLUSH_TIMEOUT_MS.
      if (event.document !== document || !session.ready || !panel.visible) return;
      event.waitUntil(this.flush(session));
    });
    const settings = vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('json.schemas') ||
        event.affectsConfiguration('json5.schemas')
      ) {
        void session.schema.refresh();
      }
    });
    panel.onDidDispose(() => {
      received.dispose();
      changes.dispose();
      saving.dispose();
      settings.dispose();
      for (const resolve of session.flushes.values()) resolve();
      session.schema.dispose();
      session.validation.dispose();
      this.sessions.delete(panel);
      this.validations.delete(panel);
      this.snapshots.delete(panel);
      // The host's cached parse of this text (core, UNK-014) can hold gigabytes for a big file.
      this.releaseParses(document);
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
          largeFile: session.largeFile && { ...session.largeFile },
        });
        session.validation.run();
        return;
      case 'edit':
        if (__CHR_TEST_HOOKS__) this.snapshots.get(session.panel)!.editsReceived++;
        if (isLocked(session)) {
          // The webview sends none while locked; the host still applies none (plan R3).
          if (__CHR_TEST_HOOKS__) this.snapshots.get(session.panel)!.readOnlyRefusals++;
          this.post(session, {
            protocol: PROTOCOL_VERSION,
            type: 'error',
            docVersion: document.version,
            code: 'read-only',
            message: READ_ONLY_MESSAGE,
          });
          return;
        }
        void session.sync.edit(message);
        return;
      case 'setDialect':
        session.schema.setDialect(message.dialect);
        return;
      case 'undo':
      case 'redo':
        if (isLocked(session)) {
          if (__CHR_TEST_HOOKS__) this.snapshots.get(session.panel)!.historyIgnored++;
          return;
        }
        void session.sync.history(message.type);
        return;
      case 'flushed':
        session.flushes.get(message.request)?.();
        session.flushes.delete(message.request);
        return;
      case 'openAsText':
        // "Reopen as Text" (commands.ts) on this document; a tab with unsaved edits stays open.
        void vscode.commands.executeCommand('chrJsonEditor.reopenAsText', document.uri);
        return;
      case 'unlock':
        // Only a large-file tab's banner sends it; the tab stays unlocked until it closes.
        if (!session.largeFile || session.largeFile.unlocked) return;
        session.largeFile = { ...session.largeFile, unlocked: true };
        if (__CHR_TEST_HOOKS__) {
          this.snapshots.get(session.panel)!.largeFile = { ...session.largeFile };
        }
        return;
      case 'error':
        void vscode.window.showErrorMessage(`CHR JSON Editor: ${message.message}`);
        return;
    }
  }

  /**
   * Asks the webview to hand over what it still holds before a save, and resolves once it says
   * every edit it made is applied, or after FLUSH_TIMEOUT_MS.
   */
  private flush(session: Session): Promise<void> {
    const request = nextFlush++;
    if (__CHR_TEST_HOOKS__) this.snapshots.get(session.panel)!.flushRequests++;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, FLUSH_TIMEOUT_MS);
      function done() {
        clearTimeout(timer);
        session.flushes.delete(request);
        resolve();
      }
      session.flushes.set(request, done);
      this.post(session, {
        protocol: PROTOCOL_VERSION,
        type: 'flush',
        docVersion: session.document.version,
        request,
      });
    });
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
      // Validation parses the text as the new format, and `$schema` is read with it too.
      session.validation.run();
      void session.schema.refresh();
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
      this.probes.get(message.id)?.(message.result);
      this.probes.delete(message.id);
    }
    if (
      (message.chrTest === 'shown' || message.chrTest === 'settled') &&
      typeof message.id === 'number'
    ) {
      const { ms } = data as { ms?: unknown };
      this.shownWaiters.get(message.id)?.(typeof ms === 'number' ? ms : undefined);
      this.shownWaiters.delete(message.id);
    }
    if (message.chrTest === 'validationShown') {
      const shown = data as Partial<ShownValidation>;
      snapshot.validationsShown.push({
        docVersion: shown.docVersion ?? -1,
        errors: shown.errors ?? null,
        reason: shown.reason ?? null,
        dialect: shown.dialect ?? null,
      });
    }
    return true;
  }

  /** Drops core's cached parses (UNK-014) that nothing needs once `document` closed, or a tab
   *  closed on it (parseRelease.ts). */
  releaseParses(document: vscode.TextDocument): void {
    const release = parseToRelease(document, this.sessions.size);
    if (release === 'all') releaseParse();
    else if (release) releaseParse(release.text);
  }

  private sessionFor(uri: string): Session | undefined {
    return [...this.sessions.values()].find((s) => s.document.uri.toString() === uri);
  }

  /** Test hook: asks the webview of `uri` what it renders. */
  probe(uri: string): Promise<RenderedProbe> {
    return this.ask<RenderedProbe>(uri, { chrTest: 'probe' });
  }

  /** Test hook: types `text` at the end of the webview's text mode (criterion 9); resolves with
   *  the webview's `Date.now()` after the last character. */
  async type(uri: string, text: string): Promise<number> {
    const result = await this.ask<{ typedAt?: number; error?: string }>(uri, {
      chrTest: 'type',
      text,
    });
    if (result.typedAt === undefined) throw new Error(`typing failed: ${result.error}`);
    return result.typedAt;
  }

  /** Test hook: runs `steps` on the webview's page, as a person would click, fill in and press
   *  keys (003 T8); resolves with what the `read` steps found. */
  async dom(uri: string, steps: DomStep[]): Promise<(string | null)[]> {
    const result = await this.ask<{ reads?: (string | null)[]; error?: string }>(uri, {
      chrTest: 'dom',
      steps,
    });
    if (!result.reads) throw new Error(`DOM steps failed: ${result.error}`);
    return result.reads;
  }

  private ask<T>(uri: string, message: { chrTest: string; [key: string]: unknown }): Promise<T> {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const session = this.sessionFor(uri);
    if (!session) return Promise.reject(new Error(`no CHR JSON Editor shows ${uri}`));
    const id = this.nextProbe++;
    return new Promise((resolve) => {
      this.probes.set(id, (result) => resolve(result as T));
      void session.panel.webview.postMessage({ ...message, id });
    });
  }

  /** Test hook: resolves once the webview of `uri` renders `text` (003 T11 benchmark), with the
   *  time since the last `patch` on the webview's clock. */
  whenShown(uri: string, text: string): Promise<number | undefined> {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const session = this.sessionFor(uri);
    if (!session) return Promise.reject(new Error(`no CHR JSON Editor shows ${uri}`));
    const id = this.nextProbe++;
    return new Promise((resolve) => {
      this.shownWaiters.set(id, resolve);
      void session.panel.webview.postMessage({ chrTest: 'whenShown', id, text });
    });
  }

  /** Test hook: resolves once the webview of `uri` has every edit answered and shown (003 T11),
   *  with the time since the last `patch` on the webview's clock. */
  whenSettled(uri: string): Promise<number | undefined> {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const session = this.sessionFor(uri);
    if (!session) return Promise.reject(new Error(`no CHR JSON Editor shows ${uri}`));
    const id = this.nextProbe++;
    return new Promise((resolve) => {
      this.shownWaiters.set(id, resolve);
      void session.panel.webview.postMessage({ chrTest: 'whenSettled', id });
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

  /** Test hook: has the webview of `uri` post `message` to the host as it is, past the UI's own
   *  checks (spec 008 plan R3: what the host does with an `edit` from a locked tab). */
  send(uri: string, message: unknown): boolean {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const session = this.sessionFor(uri);
    if (!session) return false;
    void session.panel.webview.postMessage({ chrTest: 'send', message });
    return true;
  }

  /** Test hook: has the webview of `uri` pick `dialect` in its toolbar switch, as a click would. */
  selectDialect(uri: string, dialect: string): boolean {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const session = this.sessionFor(uri);
    if (!session) return false;
    void session.panel.webview.postMessage({ chrTest: 'selectDialect', dialect });
    return true;
  }

  /** Test hook: presses Ctrl+`key` (and Shift when `shift`) in the webview of `uri` (003 T7). */
  press(uri: string, key: string, shift = false): boolean {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const session = this.sessionFor(uri);
    if (!session) return false;
    void session.panel.webview.postMessage({ chrTest: 'press', key, shift });
    return true;
  }

  /** Test hook: clicks the button titled `title` in the webview of `uri` (003 T7). */
  click(uri: string, title: string): boolean {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const session = this.sessionFor(uri);
    if (!session) return false;
    void session.panel.webview.postMessage({ chrTest: 'click', title });
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

/** Reads a local schema: an open document's text (unsaved edits included), else the file. */
async function readSchemaFile(uri: string): Promise<string> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString(true) === uri);
  if (open) return open.getText();
  // `uri` is the unencoded `toString(true)` spelling, so `Uri.parse` would read a `#`, `?` or `%`
  // in the path as a fragment, query or escape; split it by hand instead.
  const [, authority = '', path = '/'] = /^file:\/\/([^/]*)(\/.*)?$/i.exec(uri) ?? [];
  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.from({ scheme: 'file', authority, path }),
  );
  return new TextDecoder().decode(bytes);
}
