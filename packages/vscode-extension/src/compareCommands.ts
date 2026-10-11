// The compare commands (spec 007 T4, criterion 4), each opening the compare panel (comparePanel.ts):
// - "Compare With…": the active document, or the one a menu names, on the left, against a JSON,
//   JSONC or JSON5 file picked from the workspace's files or a file dialog, on the right.
// - "Compare Selected": the two files selected in the explorer, in selection order.
// - "Compare with HEAD": the document's committed version (007 T2, UNK-038) on the left, the
//   document as edited on the right. An untracked file or one outside Git shows a message instead
//   of a panel (criterion 5).
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ComparePanels } from './comparePanel';
import type { FormatBadgeController } from './formatBadgeVscode';
import { headMessage } from './gitHead';
import { readHeadOf } from './gitHeadVscode';

declare const __CHR_TEST_HOOKS__: boolean;

export const COMPARE_WITH_COMMAND = 'chrJsonEditor.compareWith';
export const COMPARE_SELECTED_COMMAND = 'chrJsonEditor.compareSelected';
export const COMPARE_WITH_HEAD_COMMAND = 'chrJsonEditor.compareWithHead';

const EXTENSIONS = ['json', 'jsonc', 'json5'];
/** How many workspace files "Compare With…" lists; the file dialog reaches the rest. */
const MAX_LISTED_FILES = 5000;

/** Test hooks only: the answer to "Compare With…"'s file pick, and the messages shown. */
export const testCompare: {
  /** Called with the listed files' URIs; returns the URI to pick, or undefined to cancel. */
  pick: ((listed: string[]) => string | undefined) | undefined;
  messages: string[];
} = { pick: undefined, messages: [] };

export function registerCompareCommands(
  panels: ComparePanels,
  badge: FormatBadgeController,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMPARE_WITH_COMMAND, async (uri?: unknown) => {
      const document = await target(badge, uri);
      if (!document) return undefined;
      const other = await pickOther(document.uri);
      if (!other) return undefined;
      return panels.open({ kind: 'document', uri: document.uri }, { kind: 'document', uri: other });
    }),
    vscode.commands.registerCommand(
      COMPARE_SELECTED_COMMAND,
      async (uri?: unknown, selected?: unknown) => {
        const uris = Array.isArray(selected) ? selected : uri instanceof vscode.Uri ? [uri] : [];
        const files = uris.filter((u): u is vscode.Uri => u instanceof vscode.Uri);
        if (files.length !== 2 || !files.every(isCompareFile)) {
          show('Select exactly two .json, .jsonc or .json5 files to compare.');
          return undefined;
        }
        return panels.open(
          { kind: 'document', uri: files[0]! },
          { kind: 'document', uri: files[1]! },
        );
      },
    ),
    vscode.commands.registerCommand(COMPARE_WITH_HEAD_COMMAND, async (uri?: unknown) => {
      const document = await target(badge, uri);
      if (!document) return undefined;
      const name = path.posix.basename(document.uri.path) || 'Untitled';
      const head = await readHeadOf(document.uri);
      const message = headMessage(name, head);
      if (message !== undefined || head.kind !== 'head') {
        show(message ?? `${name} is not in Git HEAD`);
        return undefined;
      }
      // VS Code keeps a leading UTF-8 BOM out of a document's text; the decoder drops it too.
      const text = new TextDecoder().decode(head.bytes);
      return panels.open(
        { kind: 'head', uri: document.uri, text },
        { kind: 'document', uri: document.uri },
      );
    }),
  ];
}

function isCompareFile(uri: vscode.Uri): boolean {
  const extension = path.posix.extname(uri.path).slice(1).toLowerCase();
  return EXTENSIONS.includes(extension);
}

/** The document a command compares: the one a menu names, else the active CHR JSON Editor tab's or
 *  text editor's. */
async function target(
  badge: FormatBadgeController,
  uri: unknown,
): Promise<vscode.TextDocument | undefined> {
  if (uri instanceof vscode.Uri) return vscode.workspace.openTextDocument(uri);
  const document = badge.activeDocument() ?? vscode.window.activeTextEditor?.document;
  if (!document) show('Open a JSON, JSONC or JSON5 document to compare.');
  return document;
}

interface FileItem extends vscode.QuickPickItem {
  uri?: vscode.Uri;
}

/** Asks for the file to compare `self` with: a workspace file from a list, or one from a dialog. */
async function pickOther(self: vscode.Uri): Promise<vscode.Uri | undefined> {
  const found = await vscode.workspace.findFiles(
    `**/*.{${EXTENSIONS.join(',')}}`,
    '**/node_modules/**',
    MAX_LISTED_FILES,
  );
  const listed = found
    .filter((uri) => uri.toString() !== self.toString())
    .sort((a, b) => a.path.localeCompare(b.path));
  if (__CHR_TEST_HOOKS__ && testCompare.pick) {
    const picked = testCompare.pick(listed.map((u) => u.toString()));
    return picked === undefined ? undefined : vscode.Uri.parse(picked);
  }
  const browse: FileItem = { label: '$(folder-opened) Browse…', alwaysShow: true };
  const items: FileItem[] = [
    browse,
    ...listed.map((uri) => ({
      label: path.posix.basename(uri.path),
      description: vscode.workspace.asRelativePath(
        uri.with({ path: path.posix.dirname(uri.path) }),
      ),
      uri,
    })),
  ];
  const item = await vscode.window.showQuickPick(items, {
    title: `Compare ${path.posix.basename(self.path)} with`,
    placeHolder: 'Pick a JSON, JSONC or JSON5 file',
    matchOnDescription: true,
  });
  if (!item) return undefined;
  if (item.uri) return item.uri;
  const chosen = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Compare',
    filters: { 'JSON, JSONC, JSON5': EXTENSIONS },
  });
  return chosen?.[0];
}

function show(message: string): void {
  if (__CHR_TEST_HOOKS__) testCompare.messages.push(message);
  void vscode.window.showInformationMessage(`CHR JSON Editor: ${message}`);
}
