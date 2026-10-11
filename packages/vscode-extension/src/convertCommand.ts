// "Convert to JSON / JSONC / JSON5" (spec 006 T3, criteria 6 and 7). Each command converts the
// active document, in the CHR JSON Editor or the text editor, with core's `convert` (convertPlan.ts),
// asks before removing comments or changing values, and writes the result to a new file beside the
// source with the target's extension, opened in the kind of editor the command ran from (UNK-035).
// When that file exists, a save dialog prefilled with its name picks where to write. The source
// document and file are never changed.
//
// The menus hide the command for the document's own format through two context keys: the format
// the badge holds for the active CHR JSON Editor tab (the user may have picked one), and the format
// `detect` gives the active text editor's document from its language, name and extension.
import * as vscode from 'vscode';
import { detect, type Format } from '@chr-json-editor/core';
import { confirm } from './confirm';
import { brokenMessage, convertedName, FORMAT_LABELS, lossQuestion, plan } from './convertPlan';
import { VIEW_TYPE } from './editorProvider';
import type { FormatBadgeController } from './formatBadgeVscode';

declare const __CHR_TEST_HOOKS__: boolean;

/** "Convert to JSON Lines" comes with 012 T5. */
export const CONVERT_COMMANDS: Readonly<Record<Exclude<Format, 'jsonl'>, string>> = {
  json: 'chrJsonEditor.convertToJson',
  jsonc: 'chrJsonEditor.convertToJsonc',
  json5: 'chrJsonEditor.convertToJson5',
};

/** Context keys the menus' `when` clauses read. */
export const CUSTOM_FORMAT_KEY = 'chrJsonEditor.customEditorFormat';
export const TEXT_FORMAT_KEY = 'chrJsonEditor.textEditorFormat';

/** Test hooks only: the save dialog's answer, the messages shown and the context keys set. */
export const testConvert: {
  saveAs: ((defaultUri: vscode.Uri) => vscode.Uri | undefined) | undefined;
  messages: string[];
  context: Record<string, string | undefined>;
} = { saveAs: undefined, messages: [], context: {} };

interface Source {
  document: vscode.TextDocument;
  format: Format;
  /** The command ran from a CHR JSON Editor tab (else from a text editor). */
  custom: boolean;
}

export function registerConvertCommands(badge: FormatBadgeController): vscode.Disposable[] {
  const updateText = () => setContext(TEXT_FORMAT_KEY, textFormat(vscode.window.activeTextEditor));
  const updateCustom = () => setContext(CUSTOM_FORMAT_KEY, badge.activeFormat());
  updateText();
  updateCustom();
  return [
    ...(Object.entries(CONVERT_COMMANDS) as [Format, string][]).map(([to, command]) =>
      vscode.commands.registerCommand(command, (uri?: unknown) =>
        convertActive(badge, to, uri instanceof vscode.Uri ? uri : undefined),
      ),
    ),
    vscode.window.onDidChangeActiveTextEditor(updateText),
    // Changing a document's language closes and opens it again.
    vscode.workspace.onDidOpenTextDocument(updateText),
    badge.onDidRefresh(updateCustom),
  ];
}

const contextValues = new Map<string, Format | undefined>();

/** Sets a context key, once per change (the badge refreshes after every edit). */
function setContext(key: string, format: Format | undefined): void {
  if (contextValues.has(key) && contextValues.get(key) === format) return;
  contextValues.set(key, format);
  if (__CHR_TEST_HOOKS__) testConvert.context[key] = format;
  void vscode.commands.executeCommand('setContext', key, format);
}

/** The format the command reads a text editor's document as; undefined when it is not one of ours. */
function textFormat(editor: vscode.TextEditor | undefined): Format | undefined {
  if (!editor) return undefined;
  const { document } = editor;
  const detection = detect(document.uri.path, document.languageId);
  return detection.source === 'default' ? undefined : detection.format;
}

/**
 * The document the command converts: the one in the active CHR JSON Editor tab or text editor, or,
 * from an editor title menu, the one that menu belongs to (`uri`).
 */
async function source(
  badge: FormatBadgeController,
  uri: vscode.Uri | undefined,
): Promise<Source | undefined> {
  const activeCustom = badge.activeDocument();
  const editor = vscode.window.activeTextEditor;
  const candidates: Source[] = [];
  if (activeCustom) {
    candidates.push({ document: activeCustom, format: badge.format(activeCustom)!, custom: true });
  }
  const format = textFormat(editor);
  if (editor && format) candidates.push({ document: editor.document, format, custom: false });
  if (!uri) return candidates[0];
  const match = candidates.find((c) => c.document.uri.toString() === uri.toString());
  if (match) return match;
  // A title menu of a group that is not the active one.
  const tab = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .find(
      (t) => t.input instanceof vscode.TabInputCustom && t.input.uri.toString() === uri.toString(),
    );
  const document = await vscode.workspace.openTextDocument(uri);
  const chosen = tab && badge.format(document);
  if (chosen) return { document, format: chosen, custom: true };
  return { document, format: detect(document.uri.path, document.languageId).format, custom: false };
}

async function convertActive(
  badge: FormatBadgeController,
  to: Format,
  uri: vscode.Uri | undefined,
): Promise<vscode.Uri | undefined> {
  const found = await source(badge, uri);
  if (!found) return undefined;
  const { document, format: from, custom } = found;
  const bom = await startsWithBom(document);
  let agreed: string | undefined;
  for (;;) {
    const version = document.version;
    const text = document.getText();
    const result = plan(text, from, to, bom);
    if (result.kind === 'same') {
      show('info', `CHR JSON Editor: the document is already ${FORMAT_LABELS[to]}.`);
      return undefined;
    }
    if (result.kind === 'broken') {
      const position = document.positionAt(result.offset);
      show('error', brokenMessage(from, to, position.line + 1, position.character + 1));
      return undefined;
    }
    if (result.losses.length) {
      const { message, detail } = lossQuestion(text, to, result.losses);
      // Asked again only when an edit made while asking changed what is lost.
      const question = `${message}\n${detail}`;
      if (question !== agreed) {
        if (!(await confirm(message, 'Convert', detail || undefined))) return undefined;
        agreed = question;
        if (document.isClosed) return undefined;
        if (document.version !== version) continue;
      }
    }
    return write(document, to, result.text, custom);
  }
}

/** Whether the source file on disk starts with a UTF-8 byte order mark, which VS Code keeps out of
 *  the document's text. */
async function startsWithBom(document: vscode.TextDocument): Promise<boolean> {
  if (document.isUntitled) return false;
  try {
    const bytes = await vscode.workspace.fs.readFile(document.uri);
    return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  } catch {
    return false;
  }
}

async function write(
  document: vscode.TextDocument,
  to: Format,
  text: string,
  custom: boolean,
): Promise<vscode.Uri | undefined> {
  const source = document.uri;
  const name = convertedName(
    document.isUntitled ? 'Untitled' : source.path.slice(source.path.lastIndexOf('/') + 1),
    to,
  );
  const beside = document.isUntitled ? undefined : vscode.Uri.joinPath(source, '..', name);
  let target = beside && !(await exists(beside)) ? beside : undefined;
  if (!target) {
    const defaultUri = beside ?? vscode.Uri.file(name);
    target = await saveAs(defaultUri, to);
    if (!target) return undefined;
    if (target.toString() === source.toString()) {
      show('error', 'CHR JSON Editor: the converted file must not replace the file it comes from.');
      return undefined;
    }
  }
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
  const column = vscode.window.tabGroups.activeTabGroup.viewColumn;
  if (custom) {
    await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE, {
      viewColumn: column,
      preview: false,
    });
  } else {
    await vscode.window.showTextDocument(target, { viewColumn: column, preview: false });
  }
  return target;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function saveAs(defaultUri: vscode.Uri, to: Format): Thenable<vscode.Uri | undefined> {
  if (__CHR_TEST_HOOKS__ && testConvert.saveAs)
    return Promise.resolve(testConvert.saveAs(defaultUri));
  return vscode.window.showSaveDialog({
    defaultUri,
    filters: { [FORMAT_LABELS[to]]: [to] },
    title: `Save the ${FORMAT_LABELS[to]} file as`,
  });
}

function show(kind: 'info' | 'error', message: string): void {
  if (__CHR_TEST_HOOKS__) testConvert.messages.push(message);
  if (kind === 'info') void vscode.window.showInformationMessage(message);
  else void vscode.window.showErrorMessage(message);
}
