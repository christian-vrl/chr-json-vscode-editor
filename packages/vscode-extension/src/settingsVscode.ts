// Binds the settings reader (settings.ts) to the VS Code API (spec 019 T1): each key is inspected
// for the document's URI and language, so folder, workspace, user and `[language]` values all
// count, and the same calls work in the web extension host (spec 013).
import * as vscode from 'vscode';
import { SECTION, settingsFrom, type Settings } from './settings';

/** The settings that apply to `document` now. With no `languageId` (a file not open in an editor)
 *  language values do not count, which changes nothing for a `resource` key such as the
 *  threshold. */
export function readSettings(document: { uri: vscode.Uri; languageId?: string }): Settings {
  const scope: vscode.ConfigurationScope =
    document.languageId === undefined
      ? document.uri
      : { uri: document.uri, languageId: document.languageId };
  const ours = vscode.workspace.getConfiguration(SECTION, scope);
  const editor = vscode.workspace.getConfiguration('editor', scope);
  return settingsFrom(
    (key) => ours.inspect(key),
    (key) => editor.inspect(key),
  );
}

/** Whether `event` changes a setting `readSettings` reads for `document` (A1). */
export function affectsSettings(
  event: vscode.ConfigurationChangeEvent,
  document: { uri: vscode.Uri; languageId: string },
): boolean {
  const scope = { uri: document.uri, languageId: document.languageId };
  return (
    event.affectsConfiguration(SECTION, scope) ||
    event.affectsConfiguration('editor.tabSize', scope) ||
    event.affectsConfiguration('editor.insertSpaces', scope)
  );
}

export const OPEN_SETTINGS_COMMAND = 'chrJsonEditor.openSettings';
/** The Settings editor's search for this extension's settings (C1). */
export const SETTINGS_QUERY = '@ext:christian-vrl.chr-json-editor';

/** Test hooks: the queries "Open Settings" passed to VS Code's Settings editor. */
export const testOpenSettings: { queries: string[] } = { queries: [] };

declare const __CHR_TEST_HOOKS__: boolean;

/** C1: "CHR JSON Editor: Open Settings". */
export function registerOpenSettingsCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(OPEN_SETTINGS_COMMAND, async () => {
    if (__CHR_TEST_HOOKS__) testOpenSettings.queries.push(SETTINGS_QUERY);
    await vscode.commands.executeCommand('workbench.action.openSettings', SETTINGS_QUERY);
  });
}
