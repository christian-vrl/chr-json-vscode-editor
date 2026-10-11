// "Open in CHR JSON Editor" and "Reopen as Text" (spec 003 T3). Both take the resource from the
// menu that invoked them, or from the active tab when run from the Command Palette, and swap the
// editor in place: the new editor opens in the active group and the old tab closes. A tab with
// unsaved edits stays open instead: closing it asks to save, and "Don't Save" reverts the shared
// document, losing the edits in the new editor too. The e2e test covers this.
// "Repair JSON" (003 T8) repairs the document of the active text editor with core's
// comment-keeping repair (UNK-018, UNK-028), asking first when a comment cannot be kept.
// "Open in CHR JSON Editor" checks the file's size on disk first (spec 008 T4, criterion 9): above
// VS Code's sync limit it shows a message with "Open as Text" instead of opening (sizeCeiling.ts).
import * as vscode from 'vscode';
import { detect, PatchError, repair } from '@chr-json-editor/core';
import { confirmRepair } from './confirm';
import { minimalReplacement } from './documentSync';
import { VIEW_TYPE } from './editorProvider';
import { ceilingMessage, SYNC_LIMIT } from './sizeCeiling';

declare const __CHR_TEST_HOOKS__: boolean;

export const OPEN_COMMAND = 'chrJsonEditor.openInEditor';
export const REOPEN_AS_TEXT_COMMAND = 'chrJsonEditor.reopenAsText';
export const REPAIR_COMMAND = 'chrJsonEditor.repairJson';

const OPEN_AS_TEXT = 'Open as Text';

/** Test hooks only: whether to click "Open as Text" on the ceiling message instead of showing it
 *  (false: dismiss it), and the messages shown. */
export const testCeiling: { answer: boolean | undefined; messages: string[] } = {
  answer: undefined,
  messages: [],
};

export function registerCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(OPEN_COMMAND, (uri?: vscode.Uri) => openInEditor(uri)),
    vscode.commands.registerCommand(REOPEN_AS_TEXT_COMMAND, (uri?: vscode.Uri) =>
      swapEditor(uri, 'default', isTextTab),
    ),
    vscode.commands.registerCommand(REPAIR_COMMAND, () => repairActiveEditor()),
  ];
}

/**
 * "Repair JSON": resolves true when the document was changed. The repair is computed again when
 * the document changes while the question is open, so the edit always fits the text it replaces;
 * it asks again only when the new repair removes comments the person did not agree to remove.
 */
async function repairActiveEditor(): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return false;
  const { document } = editor;
  let agreed: readonly string[] = [];
  for (;;) {
    const version = document.version;
    const text = document.getText();
    const { format } = detect(document.uri.path, document.languageId, text);
    let result;
    try {
      result = repair(text, format);
    } catch (error) {
      if (!(error instanceof PatchError)) throw error;
      void vscode.window.showErrorMessage(`CHR JSON Editor: ${error.message}`);
      return false;
    }
    if (result.text === text) {
      void vscode.window.showInformationMessage('CHR JSON Editor: the document needs no repair.');
      return false;
    }
    const { lostComments } = result;
    if (lostComments.some((comment) => !agreed.includes(comment))) {
      if (!(await confirmRepair(lostComments))) return false;
      agreed = lostComments;
      if (document.isClosed) return false;
      if (document.version !== version) continue;
    }
    const { start, end, text: replacement } = minimalReplacement(text, result.text);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(start), document.positionAt(end)),
      replacement,
    );
    return vscode.workspace.applyEdit(edit);
  }
}

/** "Open in CHR JSON Editor": the custom editor, unless the file is above VS Code's sync limit. */
async function openInEditor(uri: vscode.Uri | undefined): Promise<void> {
  const target = uri ?? tabUri(vscode.window.tabGroups.activeTabGroup.activeTab);
  if (!target) return;
  const size = await sizeOnDisk(target);
  if (size === undefined || size <= SYNC_LIMIT) {
    await swapEditor(target, VIEW_TYPE, isCustomTab);
    return;
  }
  const name = target.path.slice(target.path.lastIndexOf('/') + 1);
  if (await ceilingNotice(ceilingMessage(name, size))) {
    await swapEditor(target, 'default', isTextTab);
  }
}

/** The file's size in bytes; undefined when it has none (an untitled document, a folder). */
async function sizeOnDisk(uri: vscode.Uri): Promise<number | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return stat.type & vscode.FileType.File ? stat.size : undefined;
  } catch {
    return undefined;
  }
}

/** Shows `message` with "Open as Text"; true when the user picks it. */
async function ceilingNotice(message: string): Promise<boolean> {
  if (__CHR_TEST_HOOKS__ && testCeiling.answer !== undefined) {
    testCeiling.messages.push(message);
    return testCeiling.answer;
  }
  return (await vscode.window.showWarningMessage(message, OPEN_AS_TEXT)) === OPEN_AS_TEXT;
}

function isTextTab(tab: vscode.Tab): boolean {
  return tab.input instanceof vscode.TabInputText;
}

function isCustomTab(tab: vscode.Tab): boolean {
  return tab.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE;
}

function tabUri(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  const input = tab?.input;
  return input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom
    ? input.uri
    : undefined;
}

async function swapEditor(
  uri: vscode.Uri | undefined,
  viewType: string,
  isTarget: (tab: vscode.Tab) => boolean,
): Promise<void> {
  const group = vscode.window.tabGroups.activeTabGroup;
  const target = uri ?? tabUri(group.activeTab);
  if (!target) {
    return;
  }
  const replaced = group.tabs.filter(
    (tab) => tabUri(tab)?.toString() === target.toString() && !isTarget(tab) && !tab.isDirty,
  );
  await vscode.commands.executeCommand('vscode.openWith', target, viewType, {
    viewColumn: group.viewColumn,
    preview: false,
  });
  if (replaced.length) {
    await vscode.window.tabGroups.close(replaced);
  }
}
