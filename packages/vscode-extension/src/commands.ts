// "Open in CHR JSON Editor" and "Reopen as Text" (spec 003 T3). Both take the resource from the
// menu that invoked them, or from the active tab when run from the Command Palette, and swap the
// editor in place: the new editor opens in the active group and the old tab closes. A tab with
// unsaved edits stays open instead: closing it asks to save, and "Don't Save" reverts the shared
// document, losing the edits in the new editor too. The e2e test covers this.
import * as vscode from 'vscode';
import { VIEW_TYPE } from './editorProvider';

export const OPEN_COMMAND = 'chrJsonEditor.openInEditor';
export const REOPEN_AS_TEXT_COMMAND = 'chrJsonEditor.reopenAsText';

export function registerCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(OPEN_COMMAND, (uri?: vscode.Uri) =>
      swapEditor(uri, VIEW_TYPE, isCustomTab),
    ),
    vscode.commands.registerCommand(REOPEN_AS_TEXT_COMMAND, (uri?: vscode.Uri) =>
      swapEditor(uri, 'default', (tab) => tab.input instanceof vscode.TabInputText),
    ),
  ];
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
