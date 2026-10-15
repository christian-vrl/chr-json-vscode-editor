// "Smart Format" (spec 010 T3, criteria 8–10): lays out the document of the active CHR JSON Editor
// tab, in any mode, or of the active text editor for JSON, JSONC and JSON5, with core's
// `smartFormat` (smartFormatPlan.ts). The new text replaces the old as one WorkspaceEdit over the
// changed span, so the document is dirty, not saved, and one undo restores it; an already
// smart-formatted text gets no edit. The size guard runs first, from either editor (criterion 10).
// A CHR JSON Editor tab first hands over the typing and edits it holds, as before a save, so the
// command lays out what the tab shows; its webview gets the result as an external change.
// The line length is `chrJsonEditor.smartFormat.maxLineLength` for the document's language, read
// when the run starts (spec 019 F1, A4).
import * as vscode from 'vscode';
import type { SmartFormatFormat } from '@chr-json-editor/core';
import { textFormat } from './convertCommand';
import { minimalReplacement } from './documentSync';
import type { JsonEditorProvider } from './editorProvider';
import type { FormatBadgeController } from './formatBadgeVscode';
import { READ_ONLY_MESSAGE, thresholdBytes } from './largeFile';
import { readSettings, smartFormatOptions } from './settingsVscode';
import { plan, tooLarge } from './smartFormatPlan';

declare const __CHR_TEST_HOOKS__: boolean;

export const SMART_FORMAT_COMMAND = 'chrJsonEditor.smartFormat';

/** Test hooks only: the messages shown. */
export const testSmartFormat: { messages: string[] } = { messages: [] };

export function registerSmartFormatCommand(
  badge: FormatBadgeController,
  provider: JsonEditorProvider,
): vscode.Disposable {
  return vscode.commands.registerCommand(SMART_FORMAT_COMMAND, () =>
    smartFormatActive(badge, provider),
  );
}

/** Resolves true when the document was changed. */
async function smartFormatActive(
  badge: FormatBadgeController,
  provider: JsonEditorProvider,
): Promise<boolean> {
  const custom = badge.activeDocument();
  let document: vscode.TextDocument;
  let format: SmartFormatFormat;
  if (custom) {
    // The format the tab's editor parses it as, as the webview's action uses. JSON Lines is not
    // laid out (spec 010 §Scope); the menus do not offer the command for it.
    const chosen = badge.format(custom)!;
    if (chosen === 'jsonl') return false;
    document = custom;
    format = chosen;
  } else {
    const editor = vscode.window.activeTextEditor;
    const detected = textFormat(editor);
    // JSON Lines is not laid out (spec 010 §Scope); the menus do not offer the command for it.
    if (!editor || !detected || detected === 'jsonl') return false;
    document = editor.document;
    format = detected;
  }
  if (custom) await provider.flushDocument(document);
  if (document.isClosed) return false;
  const text = document.getText();
  // The threshold when the run starts (spec 019 A4).
  const threshold = thresholdBytes(readSettings(document));
  // A locked large-file tab takes no edit (spec 008 criterion 2): above the threshold it gets the
  // size message like any document, at or below it (changed by another editor) the read-only one.
  if (custom && provider.isLocked(document.uri) && !tooLarge(text, threshold)) {
    show('warning', READ_ONLY_MESSAGE);
    return false;
  }
  const result = plan(text, format, smartFormatOptions(document), threshold);
  if (result.kind === 'refused') {
    show(result.reason === 'broken' ? 'error' : 'warning', result.message);
    return false;
  }
  if (result.kind === 'same') return false;
  const { start, end, text: replacement } = minimalReplacement(text, result.text);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(start), document.positionAt(end)),
    replacement,
  );
  return vscode.workspace.applyEdit(edit);
}

function show(kind: 'warning' | 'error', message: string): void {
  if (__CHR_TEST_HOOKS__) testSmartFormat.messages.push(message);
  if (kind === 'warning') void vscode.window.showWarningMessage(message);
  else void vscode.window.showErrorMessage(message);
}
