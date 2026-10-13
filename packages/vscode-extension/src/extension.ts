// Extension host entry (001 T5). esbuild bundles this file into dist/extension.js; `vscode` stays
// external because VS Code supplies it at runtime. VS Code activates the extension from the
// contributed custom editor and commands (spec 003 T3).
import * as vscode from 'vscode';
import { registerCommands, testCeiling } from './commands';
import { registerCompareCommands, testCompare } from './compareCommands';
import { COMPARE_LIMIT_BYTES } from './compareModel';
import { ComparePanels, type CompareSnapshot } from './comparePanel';
import { registerConvertCommands, testConvert } from './convertCommand';
import { OPEN_COMMAND } from './commands';
import { registerCsvCommands, testCsvCommands } from './csvCommands';
import { CsvPanels, testCsvPanel, type CsvSnapshot } from './csvPanel';
import type { Mode } from '@chr-json-editor/app-shell/protocol';
import { JsonEditorProvider, type WebviewSnapshot } from './editorProvider';
import { registerSmartFormatCommand, testSmartFormat } from './smartFormatCommand';
import type { ComparePageProbe, CsvPageProbe, DomStep, RenderedProbe } from './testProbe';
import { testConfirm, type TestAnswer } from './confirm';
import { FormatBadgeController, formatCore, type FormatBadgeSnapshot } from './formatBadgeVscode';
import { webviewFormat } from './formatBadge';
import type { HeadResult } from './gitHead';
import { readHeadOf } from './gitHeadVscode';
import { cachedParseTexts, detect } from '@chr-json-editor/core';
import { testValidationLimit, VALIDATION_LIMIT_BYTES } from './largeFile';

declare const __CHR_TEST_HOOKS__: boolean;

/** Returned from `activate` only in the e2e build (`extension.exports.testHooks`). */
export interface TestHooks {
  webviews(): WebviewSnapshot[];
  /** What the webview of `uri` renders (003 T5); see webview/testHooks.ts. */
  probe(uri: string): Promise<RenderedProbe>;
  /** Resolves once the webview of `uri` renders `text`, whitespace collapsed (003 T11 benchmark),
   *  with the milliseconds since the last `patch` on the webview's clock. */
  whenShown(uri: string, text: string): Promise<number | undefined>;
  /** Resolves once the webview of `uri` has every edit answered and shown (003 T11 benchmark),
   *  with the milliseconds since the last `patch` on the webview's clock. */
  whenSettled(uri: string): Promise<number | undefined>;
  /** Has the webview of `uri` send `patch` as a tree edit (criterion 1); false when none shows it. */
  patch(uri: string, patch: unknown): boolean;
  /** Types `text` at the end of the text mode of `uri`'s webview (criterion 9); resolves with the
   *  webview's `Date.now()` after the last character. */
  type(uri: string, text: string): Promise<number>;
  /** Presses Ctrl+`key` (Shift too when `shift`) where the webview of `uri` has focus (003 T7). */
  press(uri: string, key: string, shift?: boolean): boolean;
  /** Clicks the button titled `title` in the webview of `uri` (003 T7). */
  click(uri: string, title: string): boolean;
  /** Posts `setMode` to the webview of `uri`; false when no editor shows it. */
  setMode(uri: string, mode: Mode): boolean;
  formatBadge(): FormatBadgeSnapshot;
  /** Validates the open editor of `uri` against `schema`, over the association (004 T2). */
  setSchema(uri: string, schema: object | boolean | undefined): boolean;
  /** Runs `steps` on the page of `uri`'s webview (003 T8); see testProbe.ts. */
  dom(uri: string, steps: DomStep[]): Promise<(string | null)[]>;
  /** Answers every later confirmation with `answer` instead of a dialog (undefined: show it); a
   *  function is called for each question and gives its answer. Returns the questions asked since
   *  the previous call (003 T8, UNK-018). */
  confirm(answer: TestAnswer | undefined): string[];
  /** Has the webview of `uri` post `message` to the host as it is (spec 008 plan R3). */
  send(uri: string, message: unknown): boolean;
  /** The texts whose full parse core keeps now (spec 008 criterion 8). */
  cachedParses(): string[];
  /** Picks `dialect` in the toolbar's dialect switch of the webview of `uri` (004 T5). */
  selectDialect(uri: string, dialect: string): boolean;
  /** Reads `uri`'s committed bytes from Git HEAD (007 T2, UNK-038). */
  readHead(uri: string): Promise<HeadResult>;
  /** 006 T3: answers every later save dialog of the convert commands with `answer`'s result for
   *  the prefilled URI (undefined: show the dialog). Returns the prefilled URIs, the messages
   *  shown and the menus' context keys since the previous call. */
  convert(answer: ((defaultUri: string) => string | undefined) | undefined): {
    saveAs: string[];
    messages: string[];
    context: Record<string, string | undefined>;
  };
  /** 008 T4: answers every later ceiling message of "Open in CHR JSON Editor" (true: "Open as
   *  Text", false: dismiss; undefined: show it). Returns the messages shown since the previous call. */
  ceiling(answer: boolean | undefined): string[];
  /** 010 T3: the messages "Smart Format" showed since the previous call. */
  smartFormatMessages(): string[];
  /** 007 T4: every compare panel opened so far, closed ones included. */
  compares(): CompareSnapshot[];
  /** What the open compare panel titled `title` renders. */
  probeCompare(title: string): Promise<ComparePageProbe>;
  /** Runs `steps` on the page of the open compare panel titled `title`. */
  domCompare(title: string, steps: DomStep[]): Promise<(string | null)[]>;
  /** Answers every later "Compare With…" file pick with `answer`'s result for the listed URIs
   *  (undefined: show the pick). Returns the messages the compare commands showed since the
   *  previous call. */
  comparePick(answer: ((listed: string[]) => string | undefined) | undefined): string[];
  /** 009 T4: selects the node at JSON Pointer `path` in the tree of `uri`'s webview. */
  select(uri: string, path: string): boolean;
  /** 009 T4: every CSV panel opened so far, closed ones included. */
  csvs(): CsvSnapshot[];
  /** What the open CSV panel titled `title` renders. */
  probeCsv(title: string): Promise<CsvPageProbe>;
  /** Runs `steps` on the page of the open CSV panel titled `title`. */
  domCsv(title: string, steps: DomStep[]): Promise<(string | null)[]>;
  /** Answers every later CSV open dialog with `answers.pick()` and save dialog with
   *  `answers.saveAs(prefilled URI)` (undefined: show the dialogs). Returns the save dialogs'
   *  prefilled URIs and the messages the CSV commands showed since the previous call. */
  csv(
    answers:
      | {
          pick?: () => string | undefined;
          saveAs?: (defaultUri: string) => string | undefined;
        }
      | undefined,
  ): { saveAs: string[]; messages: string[] };
  /** What `csv` returns, without changing its answers. */
  csvSeen(): { saveAs: string[]; messages: string[] };
  /** 007 T5: the compare size limit in bytes in place of UNK-037's (undefined: UNK-037's), and the
   *  answer to the text diff offered above it (true: open it, false: dismiss it, undefined: show
   *  the message). Returns UNK-037's limit. */
  compareLimit(limit: number | undefined, textDiff: boolean | undefined): number;
  /** 008 T5: the size above which a large-file tab's validation is paused, in place of UNK-041's
   *  (undefined: UNK-041's). Returns UNK-041's limit. */
  validationLimit(bytes: number | undefined): number;
  /** 008 T5: the paused-validation status-bar item for the active tab, or null when hidden. */
  pausedValidation(): { text: string; command: string } | null;
  /** 008 T5 benchmark: validates the tab of `uri` once from its text alone (UNK-041's measure),
   *  returning the milliseconds to the result posted. */
  timeValidation(uri: string): number;
  /** 008 T5 benchmark: the extension host's `process.memoryUsage()`. */
  hostMemory(): NodeJS.MemoryUsage;
  /** 008 T5 benchmark: the webview's JavaScript heap in bytes, or null if Chromium hides it. */
  webviewHeap(uri: string): Promise<number | null>;
}

/** The save dialogs the convert commands opened, by prefilled URI (test hooks). */
const convertSaveAs: string[] = [];

export function activate(context: vscode.ExtensionContext): { testHooks: TestHooks } | undefined {
  const formatBadge = new FormatBadgeController(formatCore);
  const { provider, disposable } = JsonEditorProvider.register(context, formatBadge);
  const compares = new ComparePanels(context.extensionUri, (document) =>
    webviewFormat(
      formatBadge.format(document) ??
        detect(document.uri.path, document.languageId, document.getText()).format,
    ),
  );
  const csvPanels = new CsvPanels(context.extensionUri, {
    formatOf: (document) =>
      formatBadge.format(document) ??
      detect(document.uri.path, document.languageId, document.getText()).format,
    openJson: (uri) => vscode.commands.executeCommand(OPEN_COMMAND, uri),
  });
  context.subscriptions.push(
    compares,
    csvPanels,
    formatBadge,
    disposable,
    formatBadge.onDidChangeFormat(({ document, format }) => {
      provider.formatChanged(document, webviewFormat(format));
      compares.formatChanged(document);
    }),
    ...registerCommands(),
    ...registerConvertCommands(formatBadge),
    ...registerCompareCommands(compares, formatBadge),
    ...registerCsvCommands(csvPanels, formatBadge, provider),
    registerSmartFormatCommand(formatBadge, provider),
    // core keeps the parse of the last text per format (UNK-014); a closed document's can go.
    vscode.workspace.onDidCloseTextDocument((document) => provider.releaseParses(document)),
  );
  if (__CHR_TEST_HOOKS__) {
    return {
      testHooks: {
        webviews: () => [...provider.snapshots.values()],
        probe: (uri) => provider.probe(uri),
        setMode: (uri, mode) => provider.setMode(uri, mode),
        whenShown: (uri, text) => provider.whenShown(uri, text),
        whenSettled: (uri) => provider.whenSettled(uri),
        patch: (uri, patch) => provider.patch(uri, patch),
        type: (uri, text) => provider.type(uri, text),
        press: (uri, key, shift) => provider.press(uri, key, shift),
        click: (uri, title) => provider.click(uri, title),
        formatBadge: () => formatBadge.snapshot(),
        selectDialect: (uri, dialect) => provider.selectDialect(uri, dialect),
        send: (uri, message) => provider.send(uri, message),
        cachedParses: () => cachedParseTexts(),
        dom: (uri, steps) => provider.dom(uri, steps),
        readHead: (uri) => readHeadOf(vscode.Uri.parse(uri)),
        compares: () => compares.snapshots,
        smartFormatMessages: () => testSmartFormat.messages.splice(0),
        probeCompare(title) {
          const panel = compares.find(title);
          return panel ? panel.probe() : Promise.reject(new Error(`no compare panel ${title}`));
        },
        domCompare(title, steps) {
          const panel = compares.find(title);
          return panel ? panel.dom(steps) : Promise.reject(new Error(`no compare panel ${title}`));
        },
        select: (uri, path) => provider.select(uri, path),
        csvs: () => csvPanels.snapshots,
        probeCsv(title) {
          const panel = csvPanels.find(title);
          return panel ? panel.probe() : Promise.reject(new Error(`no CSV panel ${title}`));
        },
        domCsv(title, steps) {
          const panel = csvPanels.find(title);
          return panel ? panel.dom(steps) : Promise.reject(new Error(`no CSV panel ${title}`));
        },
        csvSeen: () => ({
          saveAs: testCsvPanel.asked.splice(0),
          messages: testCsvCommands.messages.splice(0),
        }),
        csv(answers) {
          testCsvCommands.pick = answers?.pick;
          const saveAs = answers?.saveAs;
          testCsvPanel.saveAs = saveAs
            ? (defaultUri) => {
                const picked = saveAs(defaultUri.toString());
                return picked === undefined ? undefined : vscode.Uri.parse(picked);
              }
            : undefined;
          return {
            saveAs: testCsvPanel.asked.splice(0),
            messages: testCsvCommands.messages.splice(0),
          };
        },
        comparePick(answer) {
          testCompare.pick = answer;
          return testCompare.messages.splice(0);
        },
        compareLimit(limit, textDiff) {
          testCompare.limit = limit;
          testCompare.textDiff = textDiff;
          return COMPARE_LIMIT_BYTES;
        },
        convert(answer) {
          const saveAs = convertSaveAs.splice(0);
          testConvert.saveAs = answer
            ? (defaultUri) => {
                convertSaveAs.push(defaultUri.toString());
                const picked = answer(defaultUri.toString());
                return picked === undefined ? undefined : vscode.Uri.parse(picked);
              }
            : undefined;
          return {
            saveAs,
            messages: testConvert.messages.splice(0),
            context: { ...testConvert.context },
          };
        },
        validationLimit(bytes) {
          testValidationLimit.bytes = bytes;
          return VALIDATION_LIMIT_BYTES;
        },
        pausedValidation: () => provider.pausedItem.snapshot(),
        timeValidation: (uri) => provider.timeValidation(uri),
        hostMemory: () => process.memoryUsage(),
        webviewHeap: (uri) => provider.webviewHeap(uri),
        ceiling(answer) {
          testCeiling.answer = answer;
          return testCeiling.messages.splice(0);
        },
        confirm(answer) {
          testConfirm.answer = answer;
          return testConfirm.asked.splice(0);
        },
        setSchema(uri, schema) {
          let found = false;
          for (const [panel, validation] of provider.validations) {
            const snapshot = provider.snapshots.get(panel);
            if (snapshot?.uri !== uri) continue;
            validation.setSchema(schema);
            found = true;
          }
          return found;
        },
      },
    };
  }
  return undefined;
}

export function deactivate(): void {}
