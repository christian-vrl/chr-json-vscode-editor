// The CSV commands (spec 009 T4, criteria 5, 7 and 8), each opening the CSV panel (csvPanel.ts):
// - "Export to CSV…": the active document, in the CHR JSON Editor or the text editor, or the one an
//   editor title menu names. From the CHR JSON Editor the row source is what its webview shows:
//   the array of table mode, or the one array or object tree mode has selected (criterion 7). A
//   document that does not parse is not exported.
// - "Import CSV…": a CSV file picked in an open dialog, into the CHR JSON Editor's document
//   ("Replace Document Data") or a new JSON file.
// - "Convert CSV to JSON": the CSV file an explorer or editor title menu names, into a new JSON file.
// A CSV file above VS Code's sync limit (spec 008's ceiling) is not read (criterion 8).
import * as vscode from 'vscode';
import { detect, parseData } from '@chr-json-editor/core';
import { textFormat } from './convertCommand';
import { brokenMessage, rowSourceAt, tooLargeMessage } from './csvPlan';
import type { CsvPanels } from './csvPanel';
import type { JsonEditorProvider } from './editorProvider';
import type { FormatBadgeController } from './formatBadgeVscode';
import { SYNC_LIMIT } from './sizeCeiling';
import { basename } from './uriPath';

declare const __CHR_TEST_HOOKS__: boolean;

export const EXPORT_CSV_COMMAND = 'chrJsonEditor.exportCsv';
export const IMPORT_CSV_COMMAND = 'chrJsonEditor.importCsv';
export const CONVERT_CSV_COMMAND = 'chrJsonEditor.convertCsvToJson';

/** Test hooks only: the answer to "Import CSV…"'s open dialog (undefined: show the dialog), and
 *  the messages the commands showed. */
export const testCsvCommands: {
  pick: (() => string | undefined) | undefined;
  messages: string[];
} = { pick: undefined, messages: [] };

export function registerCsvCommands(
  panels: CsvPanels,
  badge: FormatBadgeController,
  provider: JsonEditorProvider,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(EXPORT_CSV_COMMAND, (uri?: unknown) =>
      exportCsv(panels, badge, provider, uri instanceof vscode.Uri ? uri : undefined),
    ),
    vscode.commands.registerCommand(IMPORT_CSV_COMMAND, (uri?: unknown) =>
      importCsv(panels, badge, uri instanceof vscode.Uri ? uri : undefined),
    ),
    vscode.commands.registerCommand(CONVERT_CSV_COMMAND, (uri?: unknown) =>
      convertCsv(panels, uri instanceof vscode.Uri ? uri : undefined),
    ),
  ];
}

function nameOf(uri: vscode.Uri, untitled = false): string {
  return untitled ? 'Untitled' : basename(uri.path);
}

/** A tab of the CHR JSON Editor shows `uri`. */
function inCustomEditor(badge: FormatBadgeController, uri: vscode.Uri): boolean {
  if (badge.activeDocument()?.uri.toString() === uri.toString()) return true;
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .some(
      (tab) =>
        tab.input instanceof vscode.TabInputCustom &&
        tab.input.viewType === 'chrJsonEditor.editor' &&
        tab.input.uri.toString() === uri.toString(),
    );
}

async function exportCsv(
  panels: CsvPanels,
  badge: FormatBadgeController,
  provider: JsonEditorProvider,
  uri: vscode.Uri | undefined,
) {
  const active = vscode.window.activeTextEditor;
  let document: vscode.TextDocument | undefined;
  if (uri) document = await vscode.workspace.openTextDocument(uri);
  else document = badge.activeDocument() ?? (textFormat(active) ? active?.document : undefined);
  if (!document) {
    show('Open a JSON, JSONC or JSON5 document to export it to CSV.');
    return undefined;
  }
  const custom = uri ? inCustomEditor(badge, uri) : badge.activeDocument() === document;
  const format =
    (custom ? badge.format(document) : undefined) ??
    detect(document.uri.path, document.languageId, document.getText()).format;
  // Data only, so core keeps no parse of a large document for the export (spec 008 criterion 6).
  const parsed = parseData(format, document.getText());
  if ('error' in parsed) {
    const position = document.positionAt(parsed.error.offset);
    show(brokenMessage(format, position.line + 1, position.character + 1), 'error');
    return undefined;
  }
  const asked = custom ? await provider.rowSource(document) : '';
  const { pointer, value } = rowSourceAt(parsed.data, asked);
  return panels.open({
    mode: 'export',
    document: document.uri,
    untitled: document.isUntitled,
    name: nameOf(document.uri, document.isUntitled),
    pointer,
    value,
  });
}

async function importCsv(
  panels: CsvPanels,
  badge: FormatBadgeController,
  uri: vscode.Uri | undefined,
) {
  const document = uri ? await vscode.workspace.openTextDocument(uri) : badge.activeDocument();
  if (!document) {
    show('Open a document in the CHR JSON Editor to import CSV into it.');
    return undefined;
  }
  const csv = await pickCsv();
  if (!csv) return undefined;
  const text = await readCsv(csv);
  if (text === undefined) return undefined;
  return panels.open({ mode: 'import', csv, name: nameOf(csv), text, target: document.uri });
}

async function convertCsv(panels: CsvPanels, uri: vscode.Uri | undefined) {
  const csv = uri ?? activeCsv() ?? (await pickCsv());
  if (!csv) return undefined;
  const text = await readCsv(csv);
  if (text === undefined) return undefined;
  return panels.open({ mode: 'import', csv, name: nameOf(csv), text, target: undefined });
}

/** The CSV file of the active tab, if it shows one. */
function activeCsv(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const uri = input instanceof vscode.TabInputText ? input.uri : undefined;
  return uri && /\.csv$/i.test(uri.path) ? uri : undefined;
}

async function pickCsv(): Promise<vscode.Uri | undefined> {
  if (__CHR_TEST_HOOKS__ && testCsvCommands.pick) {
    const picked = testCsvCommands.pick();
    return picked === undefined ? undefined : vscode.Uri.parse(picked);
  }
  const chosen = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Import',
    filters: { CSV: ['csv'] },
    title: 'Import CSV',
  });
  return chosen?.[0];
}

/**
 * The CSV file's text, as an editor shows it when one has it open (unsaved changes included), else
 * read from disk as UTF-8 (I1). Undefined, after a message, for a file above the ceiling
 * (criterion 8) or one that cannot be read.
 */
async function readCsv(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > SYNC_LIMIT) {
      show(tooLargeMessage(nameOf(uri), stat.size), 'error');
      return undefined;
    }
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch (error) {
    show(
      `can't read ${nameOf(uri)}: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return undefined;
  }
}

function show(message: string, kind: 'info' | 'error' = 'info'): void {
  const text = message.startsWith('CHR JSON Editor:') ? message : `CHR JSON Editor: ${message}`;
  if (__CHR_TEST_HOOKS__) testCsvCommands.messages.push(text);
  if (kind === 'info') void vscode.window.showInformationMessage(text);
  else void vscode.window.showErrorMessage(text);
}
