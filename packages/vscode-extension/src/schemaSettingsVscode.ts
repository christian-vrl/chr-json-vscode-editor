// Binds the schema settings collector (schemaSettings.ts) to the VS Code API (004 T3). URIs use
// `toString(true)`, the spelling the core resolver and VS Code's fileMatch matching expect.
import * as vscode from 'vscode';
import type { SchemaWorkspace } from './schemaSettings';

export function vscodeSchemaWorkspace(): SchemaWorkspace {
  const folders = new Map(
    (vscode.workspace.workspaceFolders ?? []).map((folder) => [
      folder.uri.toString(true),
      folder.uri,
    ]),
  );
  return {
    workspaceFile: vscode.workspace.workspaceFile?.toString(true),
    folders: [...folders.keys()],
    inspect: (section, folderUri) =>
      vscode.workspace
        .getConfiguration(
          section,
          folderUri === undefined ? null : (folders.get(folderUri) ?? null),
        )
        .inspect('schemas'),
  };
}
