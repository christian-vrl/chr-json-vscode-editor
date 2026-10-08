// Unit checks for 004 T3's settings collector: which `json.schemas` / `json5.schemas` levels VS Code
// applies, in what order, and where their relative urls resolve. The criterion 1 table lives in
// packages/core/test/schema-association.test.ts; the last case here runs the two together.
import { describe, expect, it } from 'vitest';
import { resolveSchemaAssociation } from '@chr-json-editor/core';
import {
  collectSchemaScopes,
  type SchemaSettingInspection,
  type SchemaSettingSection,
  type SchemaWorkspace,
} from '../../src/schemaSettings';

function workspace(
  values: Record<string, SchemaSettingInspection>,
  shape: { workspaceFile?: string; folders: string[] },
): SchemaWorkspace & { calls: string[] } {
  const calls: string[] = [];
  return {
    ...shape,
    calls,
    inspect(section: SchemaSettingSection, folderUri?: string) {
      const key = folderUri === undefined ? section : `${section}@${folderUri}`;
      calls.push(key);
      return values[key];
    },
  };
}

describe('collectSchemaScopes', () => {
  it('single folder: user level, then the workspace level based on the folder', () => {
    const ws = workspace(
      { json: { globalValue: ['user'], workspaceValue: ['ws'] } },
      { folders: ['file:///proj'] },
    );
    expect(collectSchemaScopes('json', ws)).toEqual([
      { entries: ['user'] },
      { entries: ['ws'], baseUri: 'file:///proj' },
    ]);
  });

  it('no folder open: only the user level', () => {
    const ws = workspace(
      { json5: { globalValue: ['user'], workspaceValue: ['ws'] } },
      { folders: [] },
    );
    expect(collectSchemaScopes('json5', ws)).toEqual([{ entries: ['user'] }]);
  });

  it('multi-root: user, workspace file (based on its folder), then each folder limited to itself', () => {
    const ws = workspace(
      {
        json: { globalValue: ['user'], workspaceValue: ['file'] },
        'json@file:///a': { workspaceFolderValue: ['a'] },
        'json@file:///b': {},
      },
      { workspaceFile: 'file:///w/my.code-workspace', folders: ['file:///a', 'file:///b'] },
    );
    expect(collectSchemaScopes('json', ws)).toEqual([
      { entries: ['user'] },
      { entries: ['file'], baseUri: 'file:///w' },
      { entries: ['a'], baseUri: 'file:///a', folderUri: 'file:///a' },
    ]);
    expect(ws.calls).toEqual(['json', 'json@file:///a', 'json@file:///b']);
  });

  it('feeds the resolver: a folder-relative url and the json → json5 order', () => {
    const ws = workspace(
      {
        json: { workspaceValue: [{ fileMatch: ['*.jsonc'], url: './jsonc.schema.json' }] },
        json5: { workspaceValue: [{ fileMatch: ['*.json5'], url: './conf/json5.schema.json' }] },
      },
      { folders: ['file:///proj'] },
    );
    const scopes = {
      jsonSchemas: collectSchemaScopes('json', ws),
      json5Schemas: collectSchemaScopes('json5', ws),
    };
    expect(resolveSchemaAssociation({ documentUri: 'file:///proj/x/a.json5', ...scopes })).toEqual({
      source: 'json5.schemas',
      location: { kind: 'file', uri: 'file:///proj/conf/json5.schema.json' },
    });
    expect(resolveSchemaAssociation({ documentUri: 'file:///proj/a.jsonc', ...scopes })).toEqual({
      source: 'json.schemas',
      location: { kind: 'file', uri: 'file:///proj/jsonc.schema.json' },
    });
  });
});
