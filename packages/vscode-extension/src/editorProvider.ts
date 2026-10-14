// CustomTextEditorProvider for *.json, *.jsonc, *.json5, *.jsonl and *.ndjson (spec 003 T3, 012
// T5). The document stays a normal VS Code TextDocument; the webview shows it in app-shell's editor
// (003 T5, webview/main.ts).
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
// "Reopen as Text" on the document. Above UNK-041's size a large-file tab's validation is paused:
// it runs once per click on a status-bar item (spec 008 criterion 10, pausedValidation.ts).
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
import { detect, parseData, releaseParse } from '@chr-json-editor/core';
import { confirmRepair } from './confirm';
import { DocumentSync, minimalReplacement } from './documentSync';
import { largeFileFor, READ_ONLY_MESSAGE, releaseData, validationPaused } from './largeFile';
import { PausedValidationItem } from './pausedValidation';
import { parseToRelease } from './parseRelease';
import type { FormatBadgeController } from './formatBadgeVscode';
import { SchemaBinding, schemaFileParts } from './schemaBinding';
import { openingMode, pageSettings, samePageSettings, type Settings } from './settings';
import { affectsSettings, readSettings, smartFormatOptions, writeOptions } from './settingsVscode';
import { collectSchemaScopes } from './schemaSettings';
import { vscodeSchemaWorkspace } from './schemaSettingsVscode';
import type { DomStep, RenderedProbe } from './testProbe';
import { DocumentValidation } from './validation';
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
  /** Milliseconds the extension host spent on this tab's format badge and on its schema
   *  validation (the `$schema` lookup, compiling, parsing and validating, posting the result),
   *  since it opened (008 T5 benchmark, spec 008 criterion 11). */
  hostBusy: { badgeMs: number; validationMs: number };
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
  /** `getRowSource` requests waiting for the webview's `rowSource`, by request number (009 T4). */
  rowSources: Map<number, (path: string) => void>;
  /** Large-file mode, chosen when the tab opened (spec 008); null for the normal editor. */
  largeFile: LargeFile | null;
  /** The settings for the document (spec 019), read when the tab opened and again on each change
   *  that affects them (A1). */
  settings: Settings;
  /** The mode the tab opens in (M1), chosen from the settings when it opened: a later change of
   *  `chrJsonEditor.defaultMode` leaves an open tab's mode alone (A3). */
  openMode: Mode;
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

/** How long "Export to CSV…" waits for the webview to name its row source (spec 009 criterion 7)
 *  before it exports the document's data instead. */
const ROW_SOURCE_TIMEOUT_MS = 1000;

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
  /** "Schema validation paused: large file" for the active tab (spec 008 criterion 10). */
  readonly pausedItem: PausedValidationItem;
  private readonly lockChanges = new vscode.EventEmitter<vscode.Uri>();
  /** Fires with a document's URI when a tab of it opens, closes or is unlocked: whether the
   *  document is locked (`isLocked`) may have changed (spec 009 criterion 10). */
  readonly onDidChangeLocks = this.lockChanges.event;

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly formatBadge: FormatBadgeController,
  ) {
    this.pausedItem = new PausedValidationItem(() => {
      const session = this.activeSession();
      return (
        session && {
          paused: () => session.validation.paused,
          validateOnce: () => session.validation.runOnce(),
        }
      );
    });
  }

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
      disposable: vscode.Disposable.from(
        vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider),
        provider.pausedItem,
        provider.lockChanges,
      ),
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
      // The query engine's entry, loaded by the page only when Transform first opens; its
      // WebAssembly needs 'wasm-unsafe-eval', which only this editor's page gets (spec 011 T5,
      // criterion 9; the panels keep 003's policy).
      body: `<main id="app" data-query-engine="${escapeHtml(
        webview.asWebviewUri(vscode.Uri.joinPath(dist, 'engine', 'engine.js')).toString(),
      )}"></main>`,
      wasm: true,
    });
    // Measured once: the mode stays whatever later edits do to the size (criterion 1).
    const largeFile = largeFileFor(document.getText());
    const locked = () => isLocked(session);
    const openedWith = readSettings(document);

    const validation = new DocumentValidation({
      snapshot: () => ({ text: document.getText(), docVersion: document.version }),
      format: () => this.formatOf(document),
      dataOnly: locked,
      paused: () => validationPaused(session.largeFile),
      enabled: () => session.settings['validation.enable'],
      post: (message) => this.post(session, message),
      schemaChanged: () => this.pausedItem.refresh(),
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
      rowSources: new Map(),
      largeFile,
      settings: openedWith,
      openMode: openingMode(openedWith, largeFile !== null),
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
        smartFormatOptions: () => smartFormatOptions(document),
        writeOptions: () => writeOptions(document),
      }),
    };
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
        hostBusy: { badgeMs: 0, validationMs: 0 },
      };
      const busy = snapshot.hostBusy;
      timeCalls(validation, ['setSchema', 'setUnavailable', 'run', 'runOnce'], (ms) => {
        busy.validationMs += ms;
      });
      timeCalls(schema, ['associate'], (ms) => (busy.validationMs += ms));
      this.snapshots.set(panel, snapshot);
    }
    this.sessions.set(panel, session);
    // First of the panel's dispose listeners: the badge's own (`track`, below) fires events whose
    // listeners ask for the active session, and a disposed panel throws on `active`.
    panel.onDidDispose(() => this.sessions.delete(panel));
    if (largeFile) this.lockChanges.fire(document.uri);
    this.validations.set(panel, session.validation);
    const badgeStart = performance.now();
    this.formatBadge.track(document, panel, locked);
    if (snapshot) snapshot.hostBusy.badgeMs += performance.now() - badgeStart;
    // Before the webview is ready, so the first `validation` goes out with the `ready` answer.
    void session.schema.refresh();

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
      // Spec 019 A1: settings apply without a reload. V1 reaches the open tab at once (A5).
      // D1, D2, Q1 and T1's query-language list reach the open tab at once (A2).
      if (affectsSettings(event, document)) {
        const before = pageSettings(session.settings);
        session.settings = readSettings(document);
        session.validation.enabledChanged();
        const after = pageSettings(session.settings);
        if (!samePageSettings(before, after)) {
          this.post(session, {
            protocol: PROTOCOL_VERSION,
            type: 'settings',
            docVersion: document.version,
            settings: after,
          });
        }
      }
    });
    const viewState = panel.onDidChangeViewState(() => this.pausedItem.refresh());
    panel.onDidDispose(() => {
      received.dispose();
      changes.dispose();
      saving.dispose();
      settings.dispose();
      viewState.dispose();
      for (const resolve of session.flushes.values()) resolve();
      for (const resolve of session.rowSources.values()) resolve('');
      session.schema.dispose();
      session.validation.dispose();
      this.sessions.delete(panel);
      this.validations.delete(panel);
      this.snapshots.delete(panel);
      // The host's cached parse of this text (core, UNK-014) can hold gigabytes for a big file,
      // and the data-only read a large-file tab shares for a moment about one (largeFile.ts).
      this.releaseParses(document);
      releaseData();
      this.pausedItem.refresh();
      if (session.largeFile) this.lockChanges.fire(document.uri);
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
          // M1 (spec 019): the mode chosen when the tab opened; JSON Lines opens in Table mode
          // (spec 012 criterion 6), also when the format became JSON Lines since.
          mode: this.formatOf(document) === 'jsonl' ? 'table' : session.openMode,
          // The page's settings now (019 T2): a reloaded webview gets the latest.
          settings: pageSettings(session.settings),
          largeFile: session.largeFile && { ...session.largeFile },
        });
        session.validation.run();
        this.pausedItem.refresh();
        return;
      case 'edit':
        if (__CHR_TEST_HOOKS__) this.snapshots.get(session.panel)!.editsReceived++;
        // "Repair Lines" is the one change a locked tab sends, from a large JSON Lines file's
        // bad-line banner (spec 012 criterion 10, 012 T6); the tab stays locked after it.
        if (
          isLocked(session) &&
          !(message.change.kind === 'action' && message.change.action.name === 'repairLines')
        ) {
          // The webview sends none other while locked; the host still applies none (plan R3).
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
      case 'rowSource':
        session.rowSources.get(message.request)?.(message.path);
        session.rowSources.delete(message.request);
        return;
      case 'copyText':
        // The page's "Copy JSONPath", "Copy JSON Pointer" and navigation bar copy (spec 018 S2, S3).
        void vscode.env.clipboard.writeText(message.text);
        return;
      case 'node':
      case 'revealInText':
        // The copy and reveal commands that ask for the node and show it are 018 T3's.
        return;
      case 'openAsText':
        // "Reopen as Text" (commands.ts) on this document; a tab with unsaved edits stays open. From
        // a JSON Lines tab's bad-line banner the cursor goes to the start of the first bad line
        // (spec 012 criterion 8).
        void this.openAsText(document);
        return;
      case 'unlock':
        // Only a large-file tab's banner sends it; the tab stays unlocked until it closes.
        if (!session.largeFile || session.largeFile.unlocked) return;
        session.largeFile = { ...session.largeFile, unlocked: true };
        // The badge read the data alone so far; it counts warnings again (008 T3 review).
        this.formatBadge.reparseLater(document);
        if (__CHR_TEST_HOOKS__) {
          this.snapshots.get(session.panel)!.largeFile = { ...session.largeFile };
        }
        this.lockChanges.fire(document.uri);
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

  /**
   * Has every ready tab of `document` hand over the typing it holds and the edits it sent, as before
   * a save, so a command that reads the document's text next reads what the tabs show (spec 010
   * criterion 8: "Smart Format" on a CHR JSON Editor tab in text mode).
   */
  async flushDocument(document: vscode.TextDocument): Promise<void> {
    const ready = [...this.sessions.values()].filter((s) => s.document === document && s.ready);
    await Promise.all(ready.map((session) => this.flush(session)));
  }

  /**
   * What "Export to CSV…" exports from `document`'s CHR JSON Editor tab (spec 009 criterion 7): the
   * JSON Pointer its webview names (the array table mode shows, the one value tree mode has
   * selected), or `''` for the document's data. Asks the active tab showing the document, else a
   * visible one; with none, or no answer in ROW_SOURCE_TIMEOUT_MS, the answer is `''`.
   */
  rowSource(document: vscode.TextDocument): Promise<string> {
    const shown = [...this.sessions.values()].filter(
      (s) => s.document === document && s.ready && s.panel.visible,
    );
    const session = shown.find((s) => s.panel.active) ?? shown[0];
    if (!session) return Promise.resolve('');
    const request = nextFlush++;
    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => done(''), ROW_SOURCE_TIMEOUT_MS);
      function done(path: string) {
        clearTimeout(timer);
        session!.rowSources.delete(request);
        resolve(path);
      }
      session.rowSources.set(request, done);
      this.post(session, {
        protocol: PROTOCOL_VERSION,
        type: 'getRowSource',
        docVersion: document.version,
        request,
      });
    });
  }

  /** "Open as Text": VS Code's text editor on `document`, at its first bad line when it is JSON
   *  Lines and has one. */
  private async openAsText(document: vscode.TextDocument): Promise<void> {
    const bad = this.formatOf(document) === 'jsonl' ? firstBadLine(document.getText()) : undefined;
    await vscode.commands.executeCommand('chrJsonEditor.reopenAsText', document.uri);
    if (bad === undefined || document.isClosed) return;
    const editor = [vscode.window.activeTextEditor, ...vscode.window.visibleTextEditors].find(
      (e) => e?.document === document,
    );
    if (!editor) return;
    const start = new vscode.Position(document.positionAt(bad).line, 0);
    editor.selection = new vscode.Selection(start, start);
    editor.revealRange(
      new vscode.Range(start, start),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
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

  /**
   * Whether a CHR JSON Editor tab shows the document of `uri` locked in large-file mode (spec 008
   * UNK-040): then "Import CSV…" and "Replace Document Data" are not offered for it (spec 009
   * criterion 10), as the format badge reads such a document's data alone (formatBadgeVscode.ts).
   */
  isLocked(uri: vscode.Uri): boolean {
    const key = uri.toString();
    return [...this.sessions.values()].some(
      (s) => s.document.uri.toString() === key && isLocked(s),
    );
  }

  /** Whether the active tab is a CHR JSON Editor tab locked in large-file mode. */
  activeLocked(): boolean {
    const session = this.activeSession();
    return session !== undefined && isLocked(session);
  }

  private activeSession(): Session | undefined {
    return [...this.sessions.values()].find((s) => s.panel.active);
  }

  /** Test hook (008 T5 benchmark, UNK-041): validates the tab of `uri` once as the status-bar
   *  item's click does, from the text alone (nothing kept from an earlier read), and returns the
   *  milliseconds from start to the result posted. */
  timeValidation(uri: string): number {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const session = this.sessionFor(uri);
    if (!session) throw new Error(`no CHR JSON Editor shows ${uri}`);
    releaseData();
    const start = performance.now();
    session.validation.runOnce();
    return performance.now() - start;
  }

  /** Test hook (008 T5 benchmark, plan R6): the webview's JavaScript heap in bytes, if Chromium
   *  reports it. */
  webviewHeap(uri: string): Promise<number | null> {
    return this.ask<number | null>(uri, { chrTest: 'heap' });
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

  /** Test hook: has the webview of `uri` send `patch` as a tree edit would (criterion 1): the
   *  operations, or their JSON text, read as the editor reads typed text (big numbers exact, spec 015
   *  criterion 4). */
  patch(uri: string, patch: unknown): boolean {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const session = this.sessionFor(uri);
    if (!session) return false;
    void session.panel.webview.postMessage({ chrTest: 'patch', patch });
    return true;
  }

  /** Test hook: selects the node at JSON Pointer `path` in the tree of `uri`'s webview, as a click
   *  on its row would (009 T4). */
  select(uri: string, path: string): boolean {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const session = this.sessionFor(uri);
    if (!session) return false;
    void session.panel.webview.postMessage({ chrTest: 'select', path });
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

/** Test hooks (008 T5 benchmark): adds the time each call of `target[name]` takes to `add`. A
 *  call made inside another timed call is counted once, by the outer one. */
let timing = 0;
function timeCalls<T extends object>(target: T, names: string[], add: (ms: number) => void): void {
  const methods = target as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of names) {
    const original = methods[name]!.bind(target);
    methods[name] = (...args) => {
      if (timing > 0) return original(...args);
      timing++;
      const start = performance.now();
      try {
        return original(...args);
      } finally {
        timing--;
        add(performance.now() - start);
      }
    };
  }
}

/** Reads a local schema: an open document's text (unsaved edits included), else the file, on
 *  whatever scheme the workspace uses (`file:`, or a virtual one on the web). */
async function readSchemaFile(uri: string): Promise<string> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString(true) === uri);
  if (open) return open.getText();
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.from(schemaFileParts(uri)));
  return new TextDecoder().decode(bytes);
}

/** The offset of a JSON Lines text's first bad line (L1), or undefined when it has none. Read with
 *  core's data-only `parseData`, which stops at that line and keeps no parse (spec 008 criterion 8
 *  on a large file, 012 T6). */
function firstBadLine(text: string): number | undefined {
  const result = parseData('jsonl', text);
  return 'error' in result ? result.error.offset : undefined;
}
