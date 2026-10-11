// Binds the format badge (formatBadge.ts) to VS Code (spec 003 T10, criterion 8): one status-bar
// item that shows the format of the active CHR JSON Editor tab, and the "Change Format" command
// behind it. Choosing a format re-parses the document's text in the host and never edits it; the
// editor's webviews parse again too (`onDidChangeFormat`, the `setFormat` message, 003 T5). A
// chosen format is kept for the document until the window closes, even after its last tab closes.
// While a tab shows the document locked in large-file mode (spec 008 criterion 8), the badge reads
// it with core's data-only parse, so no full parse of a big text stays in core's cache.
import * as vscode from 'vscode';
import { detect, getAdapter } from '@chr-json-editor/core';
import { dataOf } from './largeFile';
import {
  badge,
  FORMAT_LABELS,
  FORMATS,
  initialState,
  withFormat,
  type Format,
  type FormatCore,
  type FormatState,
} from './formatBadge';

export const SELECT_FORMAT_COMMAND = 'chrJsonEditor.selectFormat';

/** What the e2e test reads about the badge (test-hook builds only). */
export interface FormatBadgeSnapshot {
  visible: boolean;
  text: string;
  tooltip: string;
  command: string | undefined;
  /** The active document's URI and state, when a CHR JSON Editor tab is active. */
  uri: string | undefined;
  state: FormatState | undefined;
}

export class FormatBadgeController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  /** Per document URI, shared by every tab showing that document. */
  private readonly states = new Map<string, FormatState>();
  private readonly panels = new Map<vscode.WebviewPanel, vscode.TextDocument>();
  /** Per panel, whether it is a locked large-file tab now (spec 008). */
  private readonly locked = new Map<vscode.WebviewPanel, () => boolean>();
  /** Formats the user chose, per document URI, kept after the document's last tab closes. */
  private readonly chosen = new Map<string, Format>();
  /** Re-parses waiting after a text change, per document URI. */
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly formatChanges = new vscode.EventEmitter<{
    document: vscode.TextDocument;
    format: Format;
  }>();
  /** Fires when the user picks a format for a document. */
  readonly onDidChangeFormat = this.formatChanges.event;
  private readonly refreshes = new vscode.EventEmitter<void>();
  /** Fires after the badge followed the active tab or a format change (006 T3's menus). */
  readonly onDidRefresh = this.refreshes.event;
  private readonly disposables: vscode.Disposable[] = [];
  private visible = false;

  constructor(
    private readonly core: FormatCore,
    /** How long the badge waits after a text change before parsing again. */
    private readonly reparseDelayMs = 150,
  ) {
    this.item = vscode.window.createStatusBarItem(
      'chrJsonEditor.format',
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.name = 'CHR JSON Editor Format';
    this.item.command = SELECT_FORMAT_COMMAND;
    this.disposables.push(
      this.item,
      this.formatChanges,
      this.refreshes,
      vscode.commands.registerCommand(SELECT_FORMAT_COMMAND, (format?: unknown) =>
        this.select(format),
      ),
      // Re-parse after changes, so the badge's error state follows the text. A burst of changes
      // (typing, a webview edit) is parsed once, when it settles.
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        const key = document.uri.toString();
        if (!this.states.has(key)) return;
        clearTimeout(this.pending.get(key));
        this.pending.set(
          key,
          setTimeout(() => {
            this.pending.delete(key);
            const state = this.states.get(key);
            if (!state) return;
            this.states.set(
              key,
              withFormat(this.core, state, document.getText(), state.format, this.dataOnly(key)),
            );
            this.refresh();
          }, this.reparseDelayMs),
        );
      }),
    );
  }

  /** Called for each CHR JSON Editor tab; detects the format on the document's first tab.
   *  `locked` says whether the tab is a locked large-file tab, now. */
  track(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    locked: () => boolean = () => false,
  ): void {
    const key = document.uri.toString();
    this.panels.set(panel, document);
    this.locked.set(panel, locked);
    if (!this.states.has(key)) {
      const text = document.getText();
      const dataOnly = this.dataOnly(key);
      const state = initialState(this.core, document.uri.path, document.languageId, text, dataOnly);
      const chosen = this.chosen.get(key);
      this.states.set(key, chosen ? withFormat(this.core, state, text, chosen, dataOnly) : state);
    }
    panel.onDidChangeViewState(() => this.refresh());
    panel.onDidDispose(() => {
      this.panels.delete(panel);
      this.locked.delete(panel);
      if (![...this.panels.values()].some((d) => d.uri.toString() === key)) {
        this.states.delete(key);
        clearTimeout(this.pending.get(key));
        this.pending.delete(key);
      }
      this.refresh();
    });
    this.refresh();
  }

  /** Whether a tab shows the document of `key` locked in large-file mode: read data only. */
  private dataOnly(key: string): boolean {
    for (const [panel, document] of this.panels) {
      if (document.uri.toString() === key && this.locked.get(panel)?.()) return true;
    }
    return false;
  }

  /** The format the badge holds for `document`: the detected one, or the one the user chose. */
  format(document: vscode.TextDocument): Format | undefined {
    return this.states.get(document.uri.toString())?.format;
  }

  /** The command: `format` comes from a keybinding's `args` or a test; otherwise a Quick Pick. */
  private async select(format: unknown): Promise<void> {
    const document = this.activeDocument();
    if (!document) return;
    const key = document.uri.toString();
    const state = this.states.get(key);
    if (!state) return;
    let chosen = FORMATS.find((f) => f === format);
    if (!chosen) {
      const picked = await vscode.window.showQuickPick(
        FORMATS.map((f) => ({
          label: FORMAT_LABELS[f],
          description: [f === state.detected ? 'detected' : '', f === state.format ? 'current' : '']
            .filter(Boolean)
            .join(', '),
          format: f,
        })),
        { placeHolder: 'Parse the document as' },
      );
      if (!picked) return;
      chosen = picked.format;
    }
    this.states.set(
      key,
      withFormat(this.core, state, document.getText(), chosen, this.dataOnly(key)),
    );
    if (chosen === state.detected) this.chosen.delete(key);
    else this.chosen.set(key, chosen);
    this.refresh();
    if (chosen !== state.format) this.formatChanges.fire({ document, format: chosen });
  }

  /** The format of the active CHR JSON Editor tab's document, if one is active. */
  activeFormat(): Format | undefined {
    const document = this.activeDocument();
    return document && this.format(document);
  }

  /** The document of the active CHR JSON Editor tab, if one is active. */
  activeDocument(): vscode.TextDocument | undefined {
    for (const [panel, document] of this.panels) {
      if (panel.active) return document;
    }
    return undefined;
  }

  private refresh(): void {
    const document = this.activeDocument();
    const state = document && this.states.get(document.uri.toString());
    if (!state) {
      this.item.hide();
      this.visible = false;
    } else {
      const { text, tooltip } = badge(state);
      this.item.text = text;
      this.item.tooltip = tooltip;
      this.item.show();
      this.visible = true;
    }
    this.refreshes.fire();
  }

  snapshot(): FormatBadgeSnapshot {
    const document = this.activeDocument();
    return {
      visible: this.visible,
      text: this.item.text,
      tooltip: typeof this.item.tooltip === 'string' ? this.item.tooltip : '',
      command: typeof this.item.command === 'string' ? this.item.command : undefined,
      uri: document?.uri.toString(),
      state: document && this.states.get(document.uri.toString()),
    };
  }

  dispose(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    for (const d of this.disposables) d.dispose();
  }
}

/** The core functions the badge uses. Imported statically like everywhere else in the host (003
 *  T5): esbuild bundles core, and the editor cannot work without it anyway. */
export const formatCore: FormatCore = { detect, getAdapter, parseData: dataOf };
