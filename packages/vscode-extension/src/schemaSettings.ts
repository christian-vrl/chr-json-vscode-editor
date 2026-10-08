// Reads `json.schemas` and `json5.schemas` into the settings levels the core resolver takes (spec 004
// criterion 1, task T3), the way VS Code's own JSON client collects `json.schemas`
// (extensions/json-language-features/client/src/jsonClient.ts, getSettings): user settings first,
// then the workspace, then each workspace folder. `./` and `/` urls resolve against the workspace
// folder (or the workspace file's folder); folder-level entries apply only inside their folder.
// `json5.schemas` is the "Better JSON5" extension's setting, same shape, scope `resource`
// (BlueGlassBlock/better-json5 package.json @ 47e3158, line 66).
// This package is CommonJS and core is ESM: a type-only import of ESM from CJS needs `resolution-mode`.
import type { SchemaSettingsScope } from '@chr-json-editor/core' with {
  'resolution-mode': 'import',
};

/** What `WorkspaceConfiguration.inspect` returns, reduced to the levels used here. */
export interface SchemaSettingInspection {
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

/** The workspace facts the collector needs; `vscodeSchemaWorkspace` builds it from the real API. */
export interface SchemaWorkspace {
  /** The `.code-workspace` file, as a URI string, in a multi-root workspace. */
  workspaceFile?: string;
  /** Workspace folder URIs, in order. */
  folders: readonly string[];
  inspect(section: SchemaSettingSection, folderUri?: string): SchemaSettingInspection | undefined;
}

export type SchemaSettingSection = 'json' | 'json5';

/** The `<section>.schemas` levels in VS Code's order. */
export function collectSchemaScopes(
  section: SchemaSettingSection,
  workspace: SchemaWorkspace,
): SchemaSettingsScope[] {
  const scopes: SchemaSettingsScope[] = [];
  const top = workspace.inspect(section);
  if (top?.globalValue !== undefined) {
    scopes.push({ entries: top.globalValue });
  }
  if (workspace.workspaceFile !== undefined) {
    if (top?.workspaceValue !== undefined) {
      const fileFolder = workspace.workspaceFile.slice(0, workspace.workspaceFile.lastIndexOf('/'));
      scopes.push({ entries: top.workspaceValue, baseUri: fileFolder });
    }
    for (const folder of workspace.folders) {
      const value = workspace.inspect(section, folder)?.workspaceFolderValue;
      if (value !== undefined) {
        scopes.push({ entries: value, baseUri: folder, folderUri: folder });
      }
    }
  } else if (top?.workspaceValue !== undefined && workspace.folders.length === 1) {
    scopes.push({ entries: top.workspaceValue, baseUri: workspace.folders[0] });
  }
  return scopes;
}
