// The compare panel (spec 007 T4): a webview panel showing app-shell's compare page (webview/
// compareMain.ts) over two documents. Everything is computed here in the extension host
// (compareModel.ts, plan 007 §Approach); the page only shows it and asks for copies (ADR-003).
//
// A file side is the document as currently edited, unsaved changes included (criterion 4), and the
// panel compares again after every change to either document, wherever it was made (criterion 7).
// A HEAD side is the committed text, fixed and never written (criterion 6). A copy is applied as
// one `WorkspaceEdit`, so it is an ordinary undoable edit and nothing is saved (D4); a target file
// with no tab opens in a background tab first, so its dirty marker and save are VS Code's own.
//
// The webview gets the same CSP and `localResourceRoots` as the editor (spec 003 criterion 6,
// webviewHtml.ts). Like the editor, it posts `compareReady` once its script listens, and only then
// does the panel post the compare, again after every change.
import * as vscode from 'vscode';
import {
  decodeToCompareHost,
  type CompareDifference,
  type ToCompareHostMessage,
} from '@chr-json-editor/app-shell/protocol';
import { detect, type Format } from '@chr-json-editor/core';
import {
  buildCompare,
  compareMessage,
  compareTitle,
  copyInto,
  type CompareModel,
  type CompareSideInput,
} from './compareModel';
import { minimalReplacement } from './documentSync';
import type { ComparePageProbe, DomStep } from './testProbe';
import { createNonce, renderWebviewHtml } from './webviewHtml';

export const COMPARE_VIEW_TYPE = 'chrJsonEditor.compare';

/** Replaced by esbuild (esbuild.mjs): true only in the e2e build, so release code never has hooks. */
declare const __CHR_TEST_HOOKS__: boolean;

/**
 * How long the panel waits after a change before comparing again, so typing compares once per
 * pause rather than once per key. Criterion 7 asks for the update within 1 s.
 */
const REFRESH_DELAY_MS = 100;

/** What a compare side shows. */
export type CompareSource =
  /** A document, as currently edited. */
  | { kind: 'document'; uri: vscode.Uri }
  /** `uri`'s committed text, read from Git HEAD (007 T2). */
  | { kind: 'head'; uri: vscode.Uri; text: string };

/** What the e2e test reads about one compare panel (test-hook builds only). */
export interface CompareSnapshot {
  title: string;
  /** `left` and `right` sources: the document URI, prefixed with `head:` for a HEAD side. */
  left: string;
  right: string;
  html: string;
  cspSource: string;
  enableScripts: boolean;
  localResourceRoots: string[];
  /** The webview script sent `compareReady`. */
  scriptLoaded: boolean;
  /** The latest `compare` message posted: its version and differences. */
  version: number;
  differences: CompareDifference[];
  /** Whether the panel is still open. */
  open: boolean;
  /** Copies the panel refused or failed to apply, as shown to the user. */
  messages: string[];
}

function baseName(uri: vscode.Uri): string {
  return uri.path.slice(uri.path.lastIndexOf('/') + 1);
}

function sourceKey(source: CompareSource): string {
  return `${source.kind === 'head' ? 'head:' : ''}${source.uri.toString()}`;
}

export class ComparePanels {
  /** Open panels by their sources' keys, so the same compare is shown again, not opened twice. */
  private readonly panels = new Map<string, ComparePanel>();
  /** Filled only when `__CHR_TEST_HOOKS__` is true; kept after a panel closes. */
  readonly snapshots: CompareSnapshot[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    /** The format a document is parsed as: the one the format badge holds, else detected. */
    private readonly formatOf: (document: vscode.TextDocument) => Format,
  ) {}

  /** Opens the compare of `left` and `right`, or shows it if it is open already. */
  async open(left: CompareSource, right: CompareSource): Promise<ComparePanel> {
    const key = `${sourceKey(left)}\n${sourceKey(right)}`;
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal();
      return existing;
    }
    const panel = new ComparePanel(this.extensionUri, this.formatOf, left, right);
    this.panels.set(key, panel);
    panel.onDidDispose(() => this.panels.delete(key));
    if (__CHR_TEST_HOOKS__ && panel.snapshot) this.snapshots.push(panel.snapshot);
    await panel.refresh();
    return panel;
  }

  /** Called when the user picks another format for a document: its compares parse it again. */
  formatChanged(document: vscode.TextDocument): void {
    for (const panel of this.panels.values()) panel.formatChanged(document);
  }

  /** Test hook: the open panel titled `title`. */
  find(title: string): ComparePanel | undefined {
    return [...this.panels.values()].find((p) => p.title === title);
  }

  dispose(): void {
    for (const panel of [...this.panels.values()]) panel.dispose();
  }
}

export class ComparePanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly disposeListeners: (() => void)[] = [];
  private ready = false;
  private model: CompareModel | undefined;
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Each refresh's number; a refresh that finds a newer one started drops its result. */
  private refreshes = 0;
  readonly title: string;
  readonly snapshot: CompareSnapshot | undefined;
  /** Test hooks: probes and DOM steps waiting for the webview's answer, by id. */
  private readonly answers = new Map<number, (result: unknown) => void>();
  private nextAnswer = 1;

  constructor(
    extensionUri: vscode.Uri,
    private readonly formatOf: (document: vscode.TextDocument) => Format,
    private readonly left: CompareSource,
    private readonly right: CompareSource,
  ) {
    this.title = compareTitle(this.name(left), this.name(right));
    const dist = vscode.Uri.joinPath(extensionUri, 'dist');
    this.panel = vscode.window.createWebviewPanel(
      COMPARE_VIEW_TYPE,
      this.title,
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [dist] },
    );
    const { webview } = this.panel;
    webview.html = renderWebviewHtml({
      cspSource: webview.cspSource,
      nonce: createNonce(),
      title: this.title,
      scripts: [webview.asWebviewUri(vscode.Uri.joinPath(dist, 'compare.js')).toString()],
      stylesheets: [webview.asWebviewUri(vscode.Uri.joinPath(dist, 'compare.css')).toString()],
      body: '<main id="app"></main>',
    });
    if (__CHR_TEST_HOOKS__) {
      this.snapshot = {
        title: this.title,
        left: sourceKey(left),
        right: sourceKey(right),
        html: webview.html,
        cspSource: webview.cspSource,
        enableScripts: webview.options.enableScripts ?? false,
        localResourceRoots: (webview.options.localResourceRoots ?? []).map((u) => u.toString()),
        scriptLoaded: false,
        version: 0,
        differences: [],
        open: true,
        messages: [],
      };
    }

    const watched = [left, right].filter((s) => s.kind === 'document').map((s) => s.uri.toString());
    const touches = (document: vscode.TextDocument) => watched.includes(document.uri.toString());
    this.disposables.push(
      webview.onDidReceiveMessage((data: unknown) => this.receiveData(data)),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0 && touches(event.document)) this.schedule();
      }),
      // A file that changed on disk while no editor had it open is read again when it reopens.
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (touches(document)) this.schedule();
      }),
    );
    this.panel.onDidDispose(() => this.disposed());
  }

  private name(source: CompareSource): string {
    return source.kind === 'head' ? `${baseName(source.uri)} (HEAD)` : baseName(source.uri);
  }

  reveal(): void {
    this.panel.reveal();
  }

  onDidDispose(listener: () => void): void {
    this.disposeListeners.push(listener);
  }

  dispose(): void {
    this.panel.dispose();
  }

  formatChanged(document: vscode.TextDocument): void {
    const uri = document.uri.toString();
    if (this.left.uri.toString() === uri || this.right.uri.toString() === uri) this.schedule();
  }

  private disposed(): void {
    clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
    for (const resolve of this.answers.values()) resolve({ error: 'the compare panel closed' });
    this.answers.clear();
    if (this.snapshot) this.snapshot.open = false;
    for (const listener of this.disposeListeners) listener();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), REFRESH_DELAY_MS);
  }

  /** Reads both sides, compares them and posts the result to a ready page. */
  async refresh(): Promise<void> {
    clearTimeout(this.timer);
    const refresh = ++this.refreshes;
    const [left, right] = await Promise.all([this.read(this.left), this.read(this.right)]);
    if (refresh !== this.refreshes) return;
    this.model = buildCompare(++this.version, left, right);
    this.post();
  }

  /** A side's text and format now. A HEAD side is parsed as its working file is (plan 007). */
  private async read(source: CompareSource): Promise<CompareSideInput> {
    const name = this.name(source);
    if (source.kind === 'head') {
      const open = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === source.uri.toString(),
      );
      const format = open ? this.formatOf(open) : detect(source.uri.path).format;
      return { name, format, text: source.text, writable: false };
    }
    const document = await vscode.workspace.openTextDocument(source.uri);
    return { name, format: this.formatOf(document), text: document.getText(), writable: true };
  }

  private post(): void {
    if (!this.ready || !this.model) return;
    const message = compareMessage(this.model);
    if (this.snapshot) {
      this.snapshot.version = message.docVersion;
      this.snapshot.differences = message.differences;
    }
    void this.panel.webview.postMessage(message);
  }

  private receiveData(data: unknown): void {
    if (__CHR_TEST_HOOKS__ && this.receiveTestMessage(data)) return;
    const decoded = decodeToCompareHost(data);
    if (!decoded.ok) {
      console.error(`CHR JSON Editor: dropped a compare webview message: ${decoded.error}`);
      return;
    }
    void this.receive(decoded.message);
  }

  private async receive(message: ToCompareHostMessage): Promise<void> {
    switch (message.type) {
      case 'compareReady':
        // A webview that was hidden and shown again reloads and asks again.
        this.ready = true;
        if (this.snapshot) this.snapshot.scriptLoaded = true;
        this.post();
        return;
      case 'copy':
        await this.copy(message.docVersion, message.difference, message.to);
        return;
      case 'error':
        this.show(message.message);
        return;
    }
  }

  private async copy(
    version: number,
    difference: CompareDifference,
    to: 'left' | 'right',
  ): Promise<void> {
    const model = this.model;
    if (!model || version !== model.version) {
      this.show('The documents changed before the copy; it was not applied. Try again.');
      return;
    }
    const result = copyInto(model, difference, to);
    if (result.kind !== 'text') {
      this.show(`Cannot copy: ${result.message}`);
      return;
    }
    const target = this[to];
    if (target.kind !== 'document') return;
    const document = await vscode.workspace.openTextDocument(target.uri);
    // The text the copy was computed from is what the document must still hold.
    if (document.getText() !== model[to].text) {
      this.show('The documents changed before the copy; it was not applied. Try again.');
      return;
    }
    await this.openInBackground(target.uri);
    const { start, end, text } = minimalReplacement(document.getText(), result.text);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      target.uri,
      new vscode.Range(document.positionAt(start), document.positionAt(end)),
      text,
    );
    if (!(await vscode.workspace.applyEdit(edit))) {
      this.show(`Cannot copy: ${baseName(target.uri)} refused the edit`);
    }
  }

  /** Opens `uri` in a tab behind the compare panel when no tab shows it (criterion 6, plan R5). */
  private async openInBackground(uri: vscode.Uri): Promise<void> {
    const shown = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .some((tab) => {
        const input = tab.input;
        return (
          (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) &&
          input.uri.toString() === uri.toString()
        );
      });
    if (shown) return;
    // `vscode.open` takes `background` (VS Code's TextEditorOpenOptions): the tab opens without
    // becoming the active one, so the compare panel stays in front.
    await vscode.commands.executeCommand('vscode.open', uri, {
      viewColumn: this.panel.viewColumn ?? vscode.ViewColumn.Active,
      preview: false,
      preserveFocus: true,
      background: true,
    });
  }

  private show(message: string): void {
    if (this.snapshot) this.snapshot.messages.push(message);
    void vscode.window.showErrorMessage(`CHR JSON Editor: ${message}`);
  }

  /** Test hooks: handles the webview's answers to probes and DOM steps. */
  private receiveTestMessage(data: unknown): boolean {
    const message = data as { chrTest?: unknown; id?: unknown; result?: unknown };
    if (typeof message !== 'object' || message === null || !('chrTest' in message)) return false;
    if (message.chrTest === 'probe' && typeof message.id === 'number') {
      this.answers.get(message.id)?.(message.result);
      this.answers.delete(message.id);
    }
    return true;
  }

  /** Test hook: what the compare page renders. */
  probe(): Promise<ComparePageProbe> {
    return this.ask<ComparePageProbe>({ chrTest: 'probe' });
  }

  /** Test hook: runs `steps` on the compare page (clicking Next, the copy buttons). */
  async dom(steps: DomStep[]): Promise<(string | null)[]> {
    const result = await this.ask<{ reads?: (string | null)[]; error?: string }>({
      chrTest: 'dom',
      steps,
    });
    if (!result.reads) throw new Error(`DOM steps failed: ${result.error}`);
    return result.reads;
  }

  private ask<T>(message: { chrTest: string; [key: string]: unknown }): Promise<T> {
    if (!__CHR_TEST_HOOKS__) throw new Error('test hooks are not built in');
    const id = this.nextAnswer++;
    return new Promise((resolve) => {
      this.answers.set(id, (result) => resolve(result as T));
      void this.panel.webview.postMessage({ ...message, id });
    });
  }
}
