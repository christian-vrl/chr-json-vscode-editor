// The YAML, TOML and XML commands (spec 017 T3, criteria 5–7), on core's `importData`:
// - "Convert YAML to JSON", "Convert TOML to JSON", "Convert XML to JSON": the file an explorer or
//   editor title menu names, else the active editor's file of that kind, else one picked in an open
//   dialog filtered to the kind. The output text goes to `<name>.json` beside the source and opens
//   in the CHR JSON Editor; when that name is taken a save dialog prefilled with it picks where
//   (UNK-035), and closing it writes nothing. A source with no file on a writable file system
//   (untitled, `git:`) gives a new untitled JSON document instead.
// - "Import YAML, TOML or XML…": a file picked in an open dialog, into the document of the CHR JSON
//   Editor's active tab (or the one its title menu names), after asking, as one undoable edit made
//   of `diff` and `applyPatch` (002 R14, UNK-042), as spec 009's "Replace Document Data" does.
// A file that does not convert shows criterion 7's error and nothing changes; warnings show a
// notification whose "Show Warnings" opens the "CHR JSON Editor" output channel. The source's text
// and file are never changed. In a tab locked in large-file mode the import is not offered (the
// `chrJsonEditor.customEditorLocked` key, csvCommands.ts) and run anyway it says why (criterion 9).
// Sizes (criterion 8, 017 T4): a source above spec 008's ceiling, or a YAML source above the YAML
// limit (UNK-077), is not read; one above the threshold converts under a progress notification.
import * as vscode from 'vscode';
import {
  detect,
  importData,
  IMPORT_OUTPUT_STYLE,
  stringify,
  type ImportKind,
  type ImportWarning,
} from '@chr-json-editor/core';
import { confirm } from './confirm';
import { brokenTargetMessage, replacedText } from './csvPlan';
import { minimalReplacement } from './documentSync';
import { OPEN_COMMAND } from './commands';
import { VIEW_TYPE, type JsonEditorProvider } from './editorProvider';
import type { FormatBadgeController } from './formatBadgeVscode';
import {
  errorMessage,
  importLimit,
  IMPORT_KINDS,
  jsonLinesMessage,
  jsonName,
  KIND_EXTENSIONS,
  KIND_LABELS,
  kindOf,
  progressTitle,
  replaceQuestion,
  tooLargeMessage,
  warningLines,
  warningsMessage,
} from './importPlan';
import { thresholdBytes, utf8Length } from './largeFile';
import { readSettings } from './settingsVscode';
import { basename } from './uriPath';

declare const __CHR_TEST_HOOKS__: boolean;

export const CONVERT_IMPORT_COMMANDS: Readonly<Record<ImportKind, string>> = {
  yaml: 'chrJsonEditor.convertYamlToJson',
  toml: 'chrJsonEditor.convertTomlToJson',
  xml: 'chrJsonEditor.convertXmlToJson',
};
export const IMPORT_FILE_COMMAND = 'chrJsonEditor.importFile';

export const OUTPUT_CHANNEL = 'CHR JSON Editor';
export const SHOW_WARNINGS = 'Show Warnings';

/** Criterion 9 (017 T4): why "Import YAML, TOML or XML…" did nothing in a locked tab. */
export const LOCKED_IMPORT_MESSAGE =
  'CHR JSON Editor: this large file is read-only. Choose "Edit anyway" to import into it.';

/** Test hooks only: the answers to the open and save dialogs and to "Show Warnings" (undefined:
 *  show them), and what the commands showed: messages (progress titles included), the save
 *  dialogs' prefilled URIs and the lines written to the output channel. */
export const testImport: {
  pick: (() => string | undefined) | undefined;
  saveAs: ((defaultUri: string) => string | undefined) | undefined;
  showWarnings: boolean | undefined;
  messages: string[];
  asked: string[];
  output: string[];
} = {
  pick: undefined,
  saveAs: undefined,
  showWarnings: undefined,
  messages: [],
  asked: [],
  output: [],
};

export function registerImportCommands(
  badge: FormatBadgeController,
  provider: JsonEditorProvider,
): vscode.Disposable[] {
  const output = new Output();
  return [
    output,
    ...IMPORT_KINDS.map((kind) =>
      vscode.commands.registerCommand(CONVERT_IMPORT_COMMANDS[kind], (uri?: unknown) =>
        convertFile(kind, output, uri instanceof vscode.Uri ? uri : undefined),
      ),
    ),
    vscode.commands.registerCommand(IMPORT_FILE_COMMAND, (uri?: unknown) =>
      importFile(badge, provider, output, uri instanceof vscode.Uri ? uri : undefined),
    ),
  ];
}

/** The "CHR JSON Editor" output channel, made when the first warning is written. */
class Output implements vscode.Disposable {
  private channel: vscode.OutputChannel | undefined;

  write(lines: readonly string[]): void {
    this.channel ??= vscode.window.createOutputChannel(OUTPUT_CHANNEL);
    for (const line of lines) this.channel.appendLine(line);
    if (__CHR_TEST_HOOKS__) testImport.output.push(...lines);
  }

  show(): void {
    this.channel?.show(true);
  }

  dispose(): void {
    this.channel?.dispose();
  }
}

/** A converted file's data, or undefined after criterion 7's error. */
interface Converted {
  data: unknown;
  warnings: ImportWarning[];
}

async function convertFile(
  kind: ImportKind,
  output: Output,
  uri: vscode.Uri | undefined,
): Promise<vscode.Uri | undefined> {
  const source = uri ?? activeSource(kind) ?? (await pick([kind]));
  if (!source) return undefined;
  const name = basename(source.path);
  const read = await readSource(source, kind);
  if (!read) return undefined;
  const shown = read.untitled ? 'Untitled' : name;
  const done = await progress(shown, source, read.bytes, () => {
    const converted = convert(read.text, kind, shown);
    return converted && { converted, text: stringify(converted.data, 'json', IMPORT_OUTPUT_STYLE) };
  });
  if (!done) return undefined;
  const { converted, text } = done;
  let target: vscode.Uri | undefined;
  if (read.untitled || vscode.workspace.fs.isWritableFileSystem(source.scheme) !== true) {
    // No file on a writable file system to put the new one beside (criterion 5).
    const document = await vscode.workspace.openTextDocument({ language: 'json', content: text });
    target = document.uri;
    await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE, {
      viewColumn: vscode.window.tabGroups.activeTabGroup.viewColumn,
      preview: false,
    });
  } else {
    target = await newFile(source);
    if (!target) return undefined;
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
    await vscode.commands.executeCommand(OPEN_COMMAND, target);
  }
  warn(output, shown, converted.warnings);
  return target;
}

/** The file of the active tab when it is of `kind` (an untitled one by its language). */
function activeSource(kind: ImportKind): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const uri = input instanceof vscode.TabInputText ? input.uri : undefined;
  if (!uri) return undefined;
  if (kindOf(uri.path) === kind) return uri;
  if (uri.scheme !== 'untitled') return undefined;
  const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  return document?.languageId === kind ? uri : undefined;
}

async function importFile(
  badge: FormatBadgeController,
  provider: JsonEditorProvider,
  output: Output,
  uri: vscode.Uri | undefined,
): Promise<boolean> {
  const document = uri ? await vscode.workspace.openTextDocument(uri) : badge.activeDocument();
  if (!document) {
    show('error', 'CHR JSON Editor: open a document in the CHR JSON Editor to import into it.');
    return false;
  }
  if (provider.isLocked(document.uri)) {
    show('error', LOCKED_IMPORT_MESSAGE);
    return false;
  }
  const file = await pick(IMPORT_KINDS);
  if (!file) return false;
  const name = basename(file.path);
  const kind = kindOf(file.path);
  if (!kind) {
    show('error', `CHR JSON Editor: can't convert ${name}: it is not a YAML, TOML or XML file.`);
    return false;
  }
  const read = await readSource(file, kind);
  if (!read) return false;
  const converted = await progress(name, file, read.bytes, () => convert(read.text, kind, name));
  if (!converted) return false;
  const target = document.isUntitled ? 'Untitled' : basename(document.uri.path);
  const format =
    badge.format(document) ??
    detect(document.uri.path, document.languageId, document.getText()).format;
  if (format === 'jsonl' && !Array.isArray(converted.data)) {
    show('error', jsonLinesMessage(name, converted.data));
    return false;
  }
  if (!(await confirm(replaceQuestion(target, name), 'Replace'))) return false;
  if (document.isClosed) return false;
  const text = document.getText();
  const replaced = replacedText(text, format, converted.data);
  if ('error' in replaced) {
    const position = document.positionAt(replaced.error.offset);
    show('error', brokenTargetMessage(format, position.line + 1, position.character + 1));
    return false;
  }
  if (replaced.text !== text) {
    const { start, end, text: replacement } = minimalReplacement(text, replaced.text);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(start), document.positionAt(end)),
      replacement,
    );
    if (!(await vscode.workspace.applyEdit(edit))) {
      show('error', `CHR JSON Editor: ${target} refused the edit.`);
      return false;
    }
  } else {
    show('info', `CHR JSON Editor: ${target} already holds this data.`);
  }
  warn(output, name, converted.warnings);
  return true;
}

/** `importData`, or undefined after criterion 7's error message. */
function convert(text: string, kind: ImportKind, name: string): Converted | undefined {
  const result = importData(text, kind);
  if ('error' in result) {
    show('error', errorMessage(name, result.error));
    return undefined;
  }
  return result;
}

/**
 * Criterion 8: `task` under the progress notification "Converting <file>…" when the source is
 * above the threshold (the setting for `source`), else at once. The conversion holds the
 * extension host, so the notification is given a moment to reach the window before it starts.
 */
async function progress<T>(
  name: string,
  source: vscode.Uri,
  bytes: number,
  task: () => T,
): Promise<T> {
  // The threshold for the source when the run starts (spec 019 T1, A4).
  if (bytes <= thresholdBytes(readSettings({ uri: source }))) return task();
  const title = progressTitle(name);
  if (__CHR_TEST_HOOKS__) testImport.messages.push(title);
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return task();
    },
  );
}

/** Criterion 7: the warnings go to the output channel, and a notification offers to show them. */
function warn(output: Output, name: string, warnings: readonly ImportWarning[]): void {
  if (!warnings.length) return;
  output.write(warningLines(name, warnings));
  const message = warningsMessage(name, warnings.length);
  if (__CHR_TEST_HOOKS__) testImport.messages.push(message);
  if (__CHR_TEST_HOOKS__ && testImport.showWarnings !== undefined) {
    if (testImport.showWarnings) output.show();
    return;
  }
  void vscode.window.showInformationMessage(message, SHOW_WARNINGS).then((picked) => {
    if (picked === SHOW_WARNINGS) output.show();
  });
}

/**
 * The source's text and its size in UTF-8 bytes: an untitled or changed document's as the editor
 * holds it, else the file's bytes decoded as UTF-8 (so a UTF-16 file meets rule A1 instead of VS
 * Code's own decoding). A source above `kind`'s limit (criterion 8) is not read: a file's size
 * comes from the file system first.
 */
async function readSource(
  uri: vscode.Uri,
  kind: ImportKind,
): Promise<{ text: string; bytes: number; untitled: boolean } | undefined> {
  const name = basename(uri.path);
  const fits = (bytes: number) => {
    if (bytes <= importLimit(kind)) return true;
    show('error', tooLargeMessage(name, kind, bytes));
    return false;
  };
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  const fromEditor = (untitled: boolean) => {
    const text = open!.getText();
    const bytes = utf8Length(text);
    return fits(bytes) ? { text, bytes, untitled } : undefined;
  };
  if (open && (open.isUntitled || open.isDirty)) return fromEditor(open.isUntitled);
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (!fits(stat.size)) return undefined;
    const bytes = await vscode.workspace.fs.readFile(uri);
    // The file may have grown between the two calls.
    if (!fits(bytes.length)) return undefined;
    return { text: new TextDecoder().decode(bytes), bytes: bytes.length, untitled: false };
  } catch (error) {
    if (open) return fromEditor(false);
    show(
      'error',
      `CHR JSON Editor: can't read ${basename(uri.path)}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/** Where the JSON file goes: beside the source when the name is free, else where the save dialog
 *  says (undefined when it is closed). The source itself is refused (UNK-035). */
async function newFile(source: vscode.Uri): Promise<vscode.Uri | undefined> {
  const beside = vscode.Uri.joinPath(source, '..', jsonName(source.path));
  if (!(await exists(beside))) return beside;
  const picked = await saveAs(beside);
  if (!picked) return undefined;
  if (picked.toString() === source.toString()) {
    show('error', 'CHR JSON Editor: the new file must not replace the file it comes from.');
    return undefined;
  }
  return picked;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function pick(kinds: readonly ImportKind[]): Promise<vscode.Uri | undefined> {
  if (__CHR_TEST_HOOKS__ && testImport.pick) {
    const picked = testImport.pick();
    return picked === undefined ? undefined : vscode.Uri.parse(picked);
  }
  const label = kinds.length === 1 ? KIND_LABELS[kinds[0]!] : 'YAML, TOML or XML';
  const chosen = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: kinds.length === 1 ? 'Convert' : 'Import',
    filters: { [label]: kinds.flatMap((kind) => KIND_EXTENSIONS[kind]) },
    title: kinds.length === 1 ? `Convert ${label} to JSON` : `Import ${label}`,
  });
  return chosen?.[0];
}

function saveAs(defaultUri: vscode.Uri): Thenable<vscode.Uri | undefined> {
  if (__CHR_TEST_HOOKS__ && testImport.saveAs) {
    testImport.asked.push(defaultUri.toString());
    const picked = testImport.saveAs(defaultUri.toString());
    return Promise.resolve(picked === undefined ? undefined : vscode.Uri.parse(picked));
  }
  return vscode.window.showSaveDialog({
    defaultUri,
    filters: { JSON: ['json'] },
    title: 'Save the JSON file as',
  });
}

function show(kind: 'info' | 'error', message: string): void {
  if (__CHR_TEST_HOOKS__) testImport.messages.push(message);
  if (kind === 'info') void vscode.window.showInformationMessage(message);
  else void vscode.window.showErrorMessage(message);
}
