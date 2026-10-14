// Copy path and reveal node (spec 018 S5, S6; 018 T3). Four commands, in the command palette and,
// for VS Code's text editor on a JSON, JSONC, JSON5 or JSON Lines document, its context menu:
// - "Copy JSONPath" and "Copy JSON Pointer" put the current node's path (P1 or P2) on the clipboard
//   and say so in the status bar for three seconds. In VS Code's text editor the current node is the
//   one at the main cursor (core's `nodeAt`); in a CHR JSON Editor tab the webview names it
//   (`getNode`: its selection in tree and table mode, its cursor in text mode).
// - "Reveal in CHR JSON Editor" (from the text editor) and "Reveal in Text Editor" (from the CHR
//   JSON Editor, and its tree and table context menus) show the current node in the other editor:
//   that editor's open tab of the document, in whichever group holds it, or else in place of the
//   current tab, as "Open in CHR JSON Editor" and "Reopen as Text" swap it (UNK-082 ★). The CHR
//   JSON Editor selects the node and scrolls to it (`reveal`); the text editor puts the cursor at
//   its place (core's `placeOf`) and reveals that line in the center when it is outside the view.
// Without a node (S6: the text stops reading before the cursor, or the path has no place in the
// text) a command shows why and copies nothing and changes no tab. The commands never change the
// document; the clipboard is the only write.
import * as vscode from 'vscode';
import { detect, placeOf, type Format, type Path } from '@chr-json-editor/core';
import type { CurrentNode } from '@chr-json-editor/app-shell/protocol';
import { isCustomTab, isTextTab, OPEN_COMMAND, REOPEN_AS_TEXT_COMMAND } from './commands';
import { textFormat } from './convertCommand';
import { VIEW_TYPE, type JsonEditorProvider } from './editorProvider';
import type { FormatBadgeController } from './formatBadgeVscode';
import {
  COPIED_MS,
  copiedMessage,
  nodeAtCursor,
  nodeOutcome,
  notInDocumentMessage,
  pathText,
  type Notation,
} from './pathPlan';

declare const __CHR_TEST_HOOKS__: boolean;

export const COPY_JSON_PATH_COMMAND = 'chrJsonEditor.copyJsonPath';
export const COPY_JSON_POINTER_COMMAND = 'chrJsonEditor.copyJsonPointer';
export const REVEAL_IN_EDITOR_COMMAND = 'chrJsonEditor.revealInEditor';
export const REVEAL_IN_TEXT_COMMAND = 'chrJsonEditor.revealInText';

/** Test hooks only: the messages the commands showed and the status bar messages they set. */
export const testPathCommands: { messages: string[]; status: string[] } = {
  messages: [],
  status: [],
};

export function registerPathCommands(
  badge: FormatBadgeController,
  provider: JsonEditorProvider,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COPY_JSON_PATH_COMMAND, () =>
      copyPath(badge, provider, 'jsonPath'),
    ),
    vscode.commands.registerCommand(COPY_JSON_POINTER_COMMAND, () =>
      copyPath(badge, provider, 'jsonPointer'),
    ),
    vscode.commands.registerCommand(REVEAL_IN_EDITOR_COMMAND, () => revealInEditor(provider)),
    vscode.commands.registerCommand(REVEAL_IN_TEXT_COMMAND, () => revealInText(badge, provider)),
    provider.onDidRequestRevealInText(({ document, path }) =>
      showInText(document, formatOf(badge, document), path),
    ),
  ];
}

interface Located {
  document: vscode.TextDocument;
  format: Format;
  /** The node, or undefined when the command ran from a tab that named none in time. */
  node: CurrentNode | undefined;
}

/** The format a CHR JSON Editor tab reads the document as: the badge's, chosen or detected. */
function formatOf(badge: FormatBadgeController, document: vscode.TextDocument): Format {
  return (
    badge.format(document) ??
    detect(document.uri.path, document.languageId, document.getText()).format
  );
}

/** The active CHR JSON Editor tab's current node, after it handed over its typing. */
async function customNode(
  badge: FormatBadgeController,
  provider: JsonEditorProvider,
): Promise<Located | undefined> {
  const document = badge.activeDocument();
  if (!document) return undefined;
  await provider.flushDocument(document);
  return {
    document,
    format: formatOf(badge, document),
    node: await provider.currentNode(document),
  };
}

/** The active text editor's current node: the node at its main cursor. */
function textNode(): Located | undefined {
  const editor = vscode.window.activeTextEditor;
  const format = textFormat(editor);
  if (!editor || !format) return undefined;
  const { document } = editor;
  const offset = document.offsetAt(editor.selection.active);
  return { document, format, node: nodeAtCursor(format, document.getText(), offset) };
}

/** The node's path, or undefined after showing why there is none (S1, S6). */
function pathOf(located: Located | undefined): Path | undefined {
  if (!located?.node) return undefined;
  const outcome = nodeOutcome(located.format, located.node);
  if ('path' in outcome) return outcome.path;
  show(outcome.severity, outcome.message);
  return undefined;
}

async function copyPath(
  badge: FormatBadgeController,
  provider: JsonEditorProvider,
  notation: Notation,
): Promise<void> {
  const located = badge.activeDocument() ? await customNode(badge, provider) : textNode();
  const path = pathOf(located);
  if (!path) return;
  const text = pathText(notation, path);
  await vscode.env.clipboard.writeText(text);
  const message = copiedMessage(notation, text);
  if (__CHR_TEST_HOOKS__) testPathCommands.status.push(message);
  vscode.window.setStatusBarMessage(message, COPIED_MS);
}

/** "Reveal in CHR JSON Editor": the text editor's current node in the CHR JSON Editor. */
async function revealInEditor(provider: JsonEditorProvider): Promise<void> {
  const located = textNode();
  const path = pathOf(located);
  if (!located || !path) return;
  const { document } = located;
  const open = otherTab(document.uri, isCustomTab);
  if (open) {
    await vscode.commands.executeCommand('vscode.openWith', document.uri, VIEW_TYPE, {
      viewColumn: open.group.viewColumn,
      preview: false,
    });
  } else {
    // Checks VS Code's sync limit first, as from the editor title (spec 008 criterion 9).
    await vscode.commands.executeCommand(OPEN_COMMAND, document.uri);
  }
  await provider.reveal(document, path);
}

/** "Reveal in Text Editor" from the palette: the CHR JSON Editor's current node in the text. */
async function revealInText(
  badge: FormatBadgeController,
  provider: JsonEditorProvider,
): Promise<void> {
  const located = await customNode(badge, provider);
  const path = pathOf(located);
  if (!located || !path) return;
  await showInText(located.document, located.format, path);
}

/** Shows the node of `path` in VS Code's text editor on `document`, or says it is not there. */
async function showInText(document: vscode.TextDocument, format: Format, path: Path) {
  const place = placeOf(format, document.getText(), path);
  if (place === undefined) {
    show('error', notInDocumentMessage(path));
    return;
  }
  const open = otherTab(document.uri, isTextTab);
  let editor: vscode.TextEditor | undefined;
  if (open) {
    editor = await vscode.window.showTextDocument(document, {
      viewColumn: open.group.viewColumn,
      preview: false,
    });
  } else {
    await vscode.commands.executeCommand(REOPEN_AS_TEXT_COMMAND, document.uri);
    editor = [vscode.window.activeTextEditor, ...vscode.window.visibleTextEditors].find(
      (e) => e?.document === document,
    );
  }
  if (!editor || document.isClosed) return;
  const position = document.positionAt(place);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
}

/** An open tab of `uri` in any group that `isOther` accepts, the active group's first. */
function otherTab(uri: vscode.Uri, isOther: (tab: vscode.Tab) => boolean): vscode.Tab | undefined {
  const groups = [
    vscode.window.tabGroups.activeTabGroup,
    ...vscode.window.tabGroups.all.filter((g) => g !== vscode.window.tabGroups.activeTabGroup),
  ];
  return groups
    .flatMap((group) => group.tabs)
    .find(
      (tab) =>
        isOther(tab) && (tab.input as { uri?: vscode.Uri }).uri?.toString() === uri.toString(),
    );
}

function show(severity: 'error' | 'info', message: string): void {
  if (__CHR_TEST_HOOKS__) testPathCommands.messages.push(message);
  if (severity === 'error') void vscode.window.showErrorMessage(message);
  else void vscode.window.showInformationMessage(message);
}
