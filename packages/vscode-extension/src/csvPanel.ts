// The CSV panel (spec 009 T4, UNK-044 "Preview panel"): a webview panel showing app-shell's CSV page
// (webview/csvMain.ts) for an export of a document's row source or an import of a CSV file. The
// commands (csvCommands.ts) read the source; the page previews the first 100 rows and asks for the
// writes, which run here with the full conversion (plan 009 §Approach, ADR-003):
// - "Save CSV…" writes `<name>.csv` beside the source document, "Copy CSV" puts it on the clipboard.
// - "Create JSON File" writes `<name>.json` beside the CSV file and opens it in the CHR JSON Editor
//   ("Open in CHR JSON Editor", which shows spec 008's ceiling message for a file above it).
// - "Replace Document Data" (UNK-042) applies the CSV's data to the document "Import CSV…" ran from,
//   as one `WorkspaceEdit` made of `diff` and `applyPatch` (002 R14), so it is one undoable edit and
//   members that survive keep their comments.
// A new file whose name is taken, or with no folder to go to (an untitled source), goes where a
// save dialog prefilled with that name says, as 006's convert does (UNK-035). Nothing else writes:
// closing the panel writes nothing, and the source is never changed but by "Replace Document Data".
//
// The webview gets the same CSP and `localResourceRoots` as the editor (spec 003 criterion 6,
// webviewHtml.ts). It posts `csvReady` once its script listens, and only then does the panel post
// the source.
import * as vscode from 'vscode';
import {
  decodeToCsvHost,
  PROTOCOL_VERSION,
  type CsvRunOutcome,
  type CsvRunRequest,
  type CsvSourceMessageBody,
  type ToCsvHostMessage,
} from '@chr-json-editor/app-shell/protocol';
import type { Format } from '@chr-json-editor/core';
import {
  brokenTargetMessage,
  exportSource,
  exportText,
  importData,
  importSource,
  newJsonText,
  panelTitle,
  renamed,
  replacedText,
} from './csvPlan';
import { minimalReplacement } from './documentSync';
import type { CsvPageProbe, DomStep } from './testProbe';
import { createNonce, renderWebviewHtml } from './webviewHtml';

export const CSV_VIEW_TYPE = 'chrJsonEditor.csv';

/** Replaced by esbuild (esbuild.mjs): true only in the e2e build, so release code never has hooks. */
declare const __CHR_TEST_HOOKS__: boolean;

/** What a CSV panel converts. */
export type CsvPanelInput =
  | {
      mode: 'export';
      /** The source document, whose folder "Save CSV…" writes to. */
      document: vscode.Uri;
      untitled: boolean;
      name: string;
      /** The row source's JSON Pointer, `''` for the document's data (criterion 7). */
      pointer: string;
      /** The row source's value, read when the command ran. */
      value: unknown;
    }
  | {
      mode: 'import';
      /** The CSV file, whose folder "Create JSON File" writes to. */
      csv: vscode.Uri;
      name: string;
      text: string;
      /** The document "Replace Document Data" changes; none for "Convert CSV to JSON". */
      target: vscode.Uri | undefined;
    };

/** What the e2e test reads about one CSV panel (test-hook builds only). */
export interface CsvSnapshot {
  title: string;
  /** The source as posted to the page, its preview left out. */
  source: Omit<CsvSourceMessageBody, 'preview'>;
  html: string;
  cspSource: string;
  enableScripts: boolean;
  localResourceRoots: string[];
  /** The webview script sent `csvReady`. */
  scriptLoaded: boolean;
  open: boolean;
  /** The files written and the clipboard texts copied, as `<action> <uri>` or `copy`. */
  writes: string[];
  /** The messages shown to the user. */
  messages: string[];
}

/** Test hooks only: the save dialog's answer for the prefilled URI (undefined: show the dialog),
 *  and the prefilled URIs it was asked for. */
export const testCsvPanel: {
  saveAs: ((defaultUri: vscode.Uri) => vscode.Uri | undefined) | undefined;
  asked: string[];
} = { saveAs: undefined, asked: [] };

export interface CsvPanelHost {
  /** The format a document is parsed as: the one the format badge holds, else detected. */
  formatOf(document: vscode.TextDocument): Format;
  /** Opens a created JSON file in the CHR JSON Editor ("Open in CHR JSON Editor"). */
  openJson(uri: vscode.Uri): Thenable<unknown>;
}

function inputKey(input: CsvPanelInput): string {
  return input.mode === 'export'
    ? `export\n${input.document.toString()}\n${input.pointer}`
    : `import\n${input.csv.toString()}\n${input.target?.toString() ?? ''}`;
}

export class CsvPanels {
  /** Open panels by what they convert. */
  private readonly panels = new Map<string, CsvPanel>();
  /** Filled only when `__CHR_TEST_HOOKS__` is true; kept after a panel closes. */
  readonly snapshots: CsvSnapshot[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly host: CsvPanelHost,
  ) {}

  /** Opens a panel on `input`. A panel already open on the same source closes first, so the new
   *  one shows the source as it is now. */
  open(input: CsvPanelInput): CsvPanel {
    const key = inputKey(input);
    this.panels.get(key)?.dispose();
    const panel = new CsvPanel(this.extensionUri, this.host, input);
    this.panels.set(key, panel);
    panel.onDidDispose(() => {
      if (this.panels.get(key) === panel) this.panels.delete(key);
    });
    if (__CHR_TEST_HOOKS__ && panel.snapshot) this.snapshots.push(panel.snapshot);
    return panel;
  }

  /** Test hook: the open panel titled `title`. */
  find(title: string): CsvPanel | undefined {
    return [...this.panels.values()].find((p) => p.title === title);
  }

  dispose(): void {
    for (const panel of [...this.panels.values()]) panel.dispose();
  }
}

export class CsvPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly source: CsvSourceMessageBody;
  private readonly disposeListeners: (() => void)[] = [];
  /** A run can end after the panel closed; nothing is posted then. */
  private disposed = false;
  readonly title: string;
  readonly snapshot: CsvSnapshot | undefined;
  /** Test hooks: probes and DOM steps waiting for the webview's answer, by id. */
  private readonly answers = new Map<number, (result: unknown) => void>();
  private nextAnswer = 1;

  constructor(
    extensionUri: vscode.Uri,
    private readonly host: CsvPanelHost,
    private readonly input: CsvPanelInput,
  ) {
    this.source =
      input.mode === 'export'
        ? exportSource(input.name, input.pointer, input.value)
        : importSource(input.name, input.text, input.target !== undefined);
    this.title = panelTitle(this.source);
    const dist = vscode.Uri.joinPath(extensionUri, 'dist');
    this.panel = vscode.window.createWebviewPanel(
      CSV_VIEW_TYPE,
      this.title,
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [dist] },
    );
    const { webview } = this.panel;
    webview.html = renderWebviewHtml({
      cspSource: webview.cspSource,
      nonce: createNonce(),
      title: this.title,
      scripts: [webview.asWebviewUri(vscode.Uri.joinPath(dist, 'csv.js')).toString()],
      stylesheets: [webview.asWebviewUri(vscode.Uri.joinPath(dist, 'csv.css')).toString()],
      body: '<main id="app"></main>',
    });
    if (__CHR_TEST_HOOKS__) {
      const source: Partial<CsvSourceMessageBody> = { ...this.source };
      delete source.preview;
      this.snapshot = {
        title: this.title,
        source: source as CsvSnapshot['source'],
        html: webview.html,
        cspSource: webview.cspSource,
        enableScripts: webview.options.enableScripts ?? false,
        localResourceRoots: (webview.options.localResourceRoots ?? []).map((u) => u.toString()),
        scriptLoaded: false,
        open: true,
        writes: [],
        messages: [],
      };
    }
    const received = webview.onDidReceiveMessage((data: unknown) => this.receiveData(data));
    this.panel.onDidDispose(() => {
      this.disposed = true;
      received.dispose();
      for (const resolve of this.answers.values()) resolve({ error: 'the CSV panel closed' });
      this.answers.clear();
      if (this.snapshot) this.snapshot.open = false;
      for (const listener of this.disposeListeners) listener();
    });
  }

  onDidDispose(listener: () => void): void {
    this.disposeListeners.push(listener);
  }

  dispose(): void {
    this.panel.dispose();
  }

  private receiveData(data: unknown): void {
    if (__CHR_TEST_HOOKS__ && this.receiveTestMessage(data)) return;
    const decoded = decodeToCsvHost(data);
    if (!decoded.ok) {
      console.error(`CHR JSON Editor: dropped a CSV webview message: ${decoded.error}`);
      return;
    }
    void this.receive(decoded.message);
  }

  private async receive(message: ToCsvHostMessage): Promise<void> {
    switch (message.type) {
      case 'csvReady':
        // A webview that was hidden and shown again reloads and asks again.
        if (this.snapshot) this.snapshot.scriptLoaded = true;
        this.post({ type: 'csvSource', source: this.source });
        return;
      case 'csvRun': {
        let outcome: CsvRunOutcome;
        try {
          outcome = await this.run(message.run);
        } catch (error) {
          this.show(
            'error',
            `CHR JSON Editor: ${error instanceof Error ? error.message : String(error)}`,
          );
          outcome = { done: true };
        }
        this.post({ type: 'csvOutcome', request: message.request, outcome });
        return;
      }
      case 'error':
        this.show('error', `CHR JSON Editor: ${message.message}`);
        return;
    }
  }

  private post(
    message:
      | { type: 'csvSource'; source: CsvSourceMessageBody }
      | { type: 'csvOutcome'; request: number; outcome: CsvRunOutcome },
  ): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage({ protocol: PROTOCOL_VERSION, docVersion: 0, ...message });
  }

  /** Runs a button's request: the full conversion, then the write. */
  private async run(request: CsvRunRequest): Promise<CsvRunOutcome> {
    const input = this.input;
    if (request.action === 'save' || request.action === 'copy') {
      if (input.mode !== 'export') return { done: true };
      const result = exportText(input.value, request.options);
      if ('error' in result) return result;
      if (request.action === 'copy') {
        await vscode.env.clipboard.writeText(result.text);
        this.wrote('copy');
        vscode.window.setStatusBarMessage('CHR JSON Editor: CSV copied', 3000);
        return { done: true };
      }
      const target = await this.newFile(
        input.untitled ? undefined : input.document,
        renamed(input.name, 'csv'),
        'csv',
      );
      if (!target) return { done: true };
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(result.text));
      this.wrote(`save ${target.toString()}`);
      this.show('info', `CHR JSON Editor: saved ${baseName(target)}.`);
      return { done: true };
    }
    if (input.mode !== 'import') return { done: true };
    const { options } = request as Extract<CsvRunRequest, { action: 'createFile' | 'replaceData' }>;
    const result = importData(input.text, options);
    if ('error' in result) return result;
    if (request.action === 'createFile') {
      const target = await this.newFile(input.csv, renamed(input.name, 'json'), 'json');
      if (!target) return { done: true };
      await vscode.workspace.fs.writeFile(
        target,
        new TextEncoder().encode(newJsonText(result.data)),
      );
      this.wrote(`createFile ${target.toString()}`);
      await this.host.openJson(target);
      return { done: true };
    }
    if (input.target) await this.replaceData(input.target, result.data);
    return { done: true };
  }

  /**
   * "Replace Document Data": `data` into the document as one edit. The document's text is read
   * when the button is pressed, so an edit made while the panel was open is kept where it can be.
   */
  private async replaceData(uri: vscode.Uri, data: unknown): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const format = this.host.formatOf(document);
    const replaced = replacedText(text, format, data);
    if ('error' in replaced) {
      const position = document.positionAt(replaced.error.offset);
      this.show('error', brokenTargetMessage(format, position.line + 1, position.character + 1));
      return;
    }
    if (replaced.text === text) {
      this.show('info', `CHR JSON Editor: ${baseName(uri)} already holds this data.`);
      return;
    }
    const { start, end, text: replacement } = minimalReplacement(text, replaced.text);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(document.positionAt(start), document.positionAt(end)),
      replacement,
    );
    if (!(await vscode.workspace.applyEdit(edit))) {
      this.show('error', `CHR JSON Editor: ${baseName(uri)} refused the edit.`);
      return;
    }
    this.wrote(`replaceData ${uri.toString()}`);
  }

  /**
   * Where a new file goes: `name` beside `beside` when no file has that name, else (or with no
   * folder) where a save dialog prefilled with it says; undefined when the dialog is closed. The
   * source itself is refused (UNK-035).
   */
  private async newFile(
    beside: vscode.Uri | undefined,
    name: string,
    extension: 'csv' | 'json',
  ): Promise<vscode.Uri | undefined> {
    const next = beside ? vscode.Uri.joinPath(beside, '..', name) : undefined;
    if (next && !(await exists(next))) return next;
    const defaultUri = next ?? vscode.Uri.file(name);
    const picked = await saveAs(defaultUri, extension);
    if (!picked) return undefined;
    const source = this.input.mode === 'export' ? this.input.document : this.input.csv;
    if (picked.toString() === source.toString()) {
      this.show('error', 'CHR JSON Editor: the new file must not replace the file it comes from.');
      return undefined;
    }
    return picked;
  }

  private wrote(entry: string): void {
    if (this.snapshot) this.snapshot.writes.push(entry);
  }

  private show(kind: 'info' | 'error', message: string): void {
    if (this.snapshot) this.snapshot.messages.push(message);
    if (kind === 'info') void vscode.window.showInformationMessage(message);
    else void vscode.window.showErrorMessage(message);
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

  /** Test hook: what the CSV page renders. */
  probe(): Promise<CsvPageProbe> {
    return this.ask<CsvPageProbe>({ chrTest: 'probe' });
  }

  /** Test hook: runs `steps` on the CSV page (options, buttons). */
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

function baseName(uri: vscode.Uri): string {
  return uri.path.slice(uri.path.lastIndexOf('/') + 1);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function saveAs(
  defaultUri: vscode.Uri,
  extension: 'csv' | 'json',
): Thenable<vscode.Uri | undefined> {
  if (__CHR_TEST_HOOKS__ && testCsvPanel.saveAs) {
    testCsvPanel.asked.push(defaultUri.toString());
    return Promise.resolve(testCsvPanel.saveAs(defaultUri));
  }
  const label = extension === 'csv' ? 'CSV' : 'JSON';
  return vscode.window.showSaveDialog({
    defaultUri,
    filters: { [label]: [extension] },
    title: `Save the ${label} file as`,
  });
}
