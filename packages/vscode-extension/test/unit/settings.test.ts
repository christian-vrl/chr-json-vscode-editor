// Spec 019 T1: criterion 1 (the manifest's `contributes.configuration` is exactly §Settings' table)
// and criterion 2 (the settings reader, given VS Code's `inspect` results, returns each value, the
// language value over the plain one, and the default for every wrong type or out-of-range value).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDITOR_SETTINGS } from '@chr-json-editor/app-shell/protocol';
import {
  DEFAULT_SETTINGS,
  effectiveValue,
  openingMode,
  pageSettings,
  samePageSettings,
  SETTINGS,
  settingsFrom,
  type Inspected,
  type SettingKey,
} from '../../src/settings';

const manifest = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as {
  capabilities: unknown;
  contributes: {
    configuration: { title: string; properties: Record<string, Record<string, unknown>> };
    commands: { command: string; title: string; category: string }[];
  };
};

/** Spec 019 §Settings, written out again here so the test does not read it from the code. */
const SPEC_TABLE: Record<string, Record<string, unknown>> = {
  'chrJsonEditor.defaultMode': {
    type: 'string',
    enum: ['tree', 'text', 'table'],
    default: 'tree',
    scope: 'language-overridable',
  },
  'chrJsonEditor.largeFileThreshold': {
    type: 'integer',
    minimum: 1,
    maximum: 50,
    default: 5,
    scope: 'resource',
  },
  'chrJsonEditor.smartFormat.maxLineLength': {
    type: 'integer',
    minimum: 20,
    maximum: 1000,
    default: 120,
    scope: 'language-overridable',
  },
  'chrJsonEditor.transform.defaultQueryLanguage': {
    type: 'string',
    enum: ['jsonquery', 'jmespath', 'jsonpath-rfc9535', 'jsonpath', 'javascript', 'lodash'],
    default: 'jsonquery',
    scope: 'resource',
  },
  'chrJsonEditor.validation.enable': { type: 'boolean', default: true, scope: 'resource' },
  'chrJsonEditor.table.flattenColumns': { type: 'boolean', default: true, scope: 'resource' },
  'chrJsonEditor.escapeControlCharacters': { type: 'boolean', default: false, scope: 'resource' },
  'chrJsonEditor.escapeUnicodeCharacters': { type: 'boolean', default: false, scope: 'resource' },
};

/** The fields criterion 1 names; descriptions and labels are free text. */
const CHECKED = ['type', 'enum', 'minimum', 'maximum', 'default', 'scope'];

describe('contributes.configuration (spec 019 criterion 1)', () => {
  const { configuration } = manifest.contributes;

  it('is one section titled "CHR JSON Editor" with exactly §Settings’ keys', () => {
    expect(configuration.title).toBe('CHR JSON Editor');
    expect(Object.keys(configuration.properties).sort()).toEqual(Object.keys(SPEC_TABLE).sort());
  });

  it('gives each key its type, enum, range, default and scope, and a markdownDescription', () => {
    for (const [key, expected] of Object.entries(SPEC_TABLE)) {
      const declared = configuration.properties[key]!;
      const picked = Object.fromEntries(
        CHECKED.filter((field) => field in declared).map((field) => [field, declared[field]]),
      );
      expect(picked, key).toEqual(expected);
      expect(typeof declared.markdownDescription, key).toBe('string');
      expect((declared.markdownDescription as string).trim().length, key).toBeGreaterThan(0);
      expect(['machine', 'machine-overridable', 'application', 'window']).not.toContain(
        declared.scope,
      );
    }
  });

  it('matches the reader’s table, so the reader and the manifest agree', () => {
    for (const [key, { rule, default: fallback, scope }] of Object.entries(SETTINGS)) {
      const declared = configuration.properties[`chrJsonEditor.${key}`]!;
      expect({ ...rule, default: fallback, scope }, key).toEqual(
        Object.fromEntries(
          CHECKED.filter((field) => field in declared).map((field) => [field, declared[field]]),
        ),
      );
    }
  });

  it('leaves capabilities as they were (no untrustedWorkspaces, UNK-086)', () => {
    expect(manifest.capabilities).toEqual({ virtualWorkspaces: true });
  });

  it('contributes "CHR JSON Editor: Open Settings" (C1)', () => {
    expect(manifest.contributes.commands).toContainEqual({
      command: 'chrJsonEditor.openSettings',
      title: 'Open Settings',
      category: 'CHR JSON Editor',
    });
  });
});

/** A reader over a table of `inspect` results, by full key. */
function read(table: Record<string, Inspected>) {
  return settingsFrom(
    (key) => table[`chrJsonEditor.${key}`],
    (key) => table[`editor.${key}`],
  );
}

describe('settingsFrom (spec 019 criterion 2)', () => {
  it('reads every key at its default when nothing is set', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      defaultMode: 'tree',
      largeFileThreshold: 5,
      'smartFormat.maxLineLength': 120,
      'transform.defaultQueryLanguage': 'jsonquery',
      'validation.enable': true,
      'table.flattenColumns': true,
      escapeControlCharacters: false,
      escapeUnicodeCharacters: false,
      // VS Code's defaults: editor.insertSpaces true, editor.tabSize 4 (UNK-088 ★).
      indent: 4,
    });
  });

  it('returns each value that is set', () => {
    expect(
      read({
        'chrJsonEditor.defaultMode': { globalValue: 'table' },
        'chrJsonEditor.largeFileThreshold': { workspaceValue: 6 },
        'chrJsonEditor.smartFormat.maxLineLength': { workspaceFolderValue: 60 },
        'chrJsonEditor.transform.defaultQueryLanguage': { globalValue: 'jmespath' },
        'chrJsonEditor.validation.enable': { workspaceValue: false },
        'chrJsonEditor.table.flattenColumns': { globalValue: false },
        'chrJsonEditor.escapeControlCharacters': { globalValue: true },
        'chrJsonEditor.escapeUnicodeCharacters': { workspaceFolderValue: true },
        'editor.tabSize': { globalValue: 3 },
      }),
    ).toEqual({
      defaultMode: 'table',
      largeFileThreshold: 6,
      'smartFormat.maxLineLength': 60,
      'transform.defaultQueryLanguage': 'jmespath',
      'validation.enable': false,
      'table.flattenColumns': false,
      escapeControlCharacters: true,
      escapeUnicodeCharacters: true,
      indent: 3,
    });
  });

  it('takes the bounds of each range', () => {
    for (const [key, low, high] of [
      ['largeFileThreshold', 1, 50],
      ['smartFormat.maxLineLength', 20, 1000],
    ] as const) {
      for (const value of [low, high]) {
        expect(read({ [`chrJsonEditor.${key}`]: { globalValue: value } })[key]).toBe(value);
      }
    }
  });

  it('takes the narrowest level: folder over workspace over user over default', () => {
    const mode = (inspected: Inspected) =>
      read({ 'chrJsonEditor.defaultMode': inspected }).defaultMode;
    expect(mode({ defaultValue: 'tree', globalValue: 'table' })).toBe('table');
    expect(mode({ globalValue: 'table', workspaceValue: 'text' })).toBe('text');
    expect(
      mode({ globalValue: 'table', workspaceValue: 'text', workspaceFolderValue: 'tree' }),
    ).toBe('tree');
  });

  it('takes the language value over the plain one, at any level (language-overridable keys)', () => {
    // Criterion 3's settings: `"table"` in the workspace, `[json]` `"text"`.
    expect(
      read({
        'chrJsonEditor.defaultMode': { workspaceValue: 'table', workspaceLanguageValue: 'text' },
      }).defaultMode,
    ).toBe('text');
    // A user `[json]` value wins over a plain folder value (VS Code's docs: "even if the
    // non-language-specific setting has a narrower scope").
    expect(
      read({
        'chrJsonEditor.defaultMode': { globalLanguageValue: 'text', workspaceFolderValue: 'table' },
      }).defaultMode,
    ).toBe('text');
    expect(
      read({
        'chrJsonEditor.smartFormat.maxLineLength': {
          globalLanguageValue: 60,
          workspaceLanguageValue: 200,
          workspaceFolderValue: 80,
        },
      })['smartFormat.maxLineLength'],
    ).toBe(200);
    // I1 reads `[json]`'s editor.tabSize and editor.insertSpaces the same way.
    expect(
      read({
        'editor.tabSize': { globalValue: 2, workspaceLanguageValue: 4 },
        'editor.insertSpaces': { globalLanguageValue: true },
      }).indent,
    ).toBe(4);
  });

  it('ignores a language value for a resource key, as VS Code does', () => {
    expect(
      read({
        'chrJsonEditor.largeFileThreshold': { globalValue: 6, workspaceLanguageValue: 7 },
      }).largeFileThreshold,
    ).toBe(6);
  });

  it('reads a tab as the indent when editor.insertSpaces is false (I1)', () => {
    expect(read({ 'editor.insertSpaces': { workspaceLanguageValue: false } }).indent).toBe('\t');
    expect(
      read({
        'editor.insertSpaces': { globalValue: false },
        'editor.tabSize': { globalValue: 2 },
      }).indent,
    ).toBe('\t');
  });

  it('reads every wrong type and out-of-range value as the default (A6)', () => {
    const wrong: [SettingKey, unknown[]][] = [
      ['defaultMode', ['TREE', 'Tree', '', 'code', 0, true, null, ['tree'], { mode: 'tree' }]],
      // `"10"` and `"5"` are strings, never numbers. (`1e1` in settings.json is JSON's spelling of
      // the number 10, so it arrives as 10 and is read as 10: see below.)
      ['largeFileThreshold', ['5', '10', '1e1', 0, 51, 2.5, -1, NaN, Infinity, null, true, [5]]],
      ['smartFormat.maxLineLength', ['120', 19, 1001, 60.5, null, false]],
      [
        'transform.defaultQueryLanguage',
        ['JMESPath', 'jsonata', 'jsonpath-rfc', '', 1, null, ['jmespath']],
      ],
      ['validation.enable', ['false', 'true', 0, 1, null, {}]],
      ['table.flattenColumns', ['false', 0, null]],
      ['escapeControlCharacters', ['true', 1, null]],
      ['escapeUnicodeCharacters', ['true', 1, null]],
    ];
    for (const [key, values] of wrong) {
      for (const value of values) {
        // The wrong value wins over a valid wider one: it reads as the default, not the next level.
        const settings = read({
          [`chrJsonEditor.${key}`]: { globalValue: DEFAULT_SETTINGS[key], workspaceValue: value },
        });
        expect(settings[key], `${key} = ${JSON.stringify(value)}`).toBe(DEFAULT_SETTINGS[key]);
      }
    }
  });

  it('reads 1e1 as 10: settings.json’s JSON parser gives the number 10 for it', () => {
    const parsed = JSON.parse('{"chrJsonEditor.largeFileThreshold": 1e1}') as Record<
      string,
      unknown
    >;
    expect(
      read({
        'chrJsonEditor.largeFileThreshold': {
          globalValue: parsed['chrJsonEditor.largeFileThreshold'],
        },
      }).largeFileThreshold,
    ).toBe(10);
  });

  it('reads a wrong editor.tabSize or editor.insertSpaces as VS Code’s default', () => {
    for (const tabSize of ['2', 0, 101, 2.5, null]) {
      expect(read({ 'editor.tabSize': { globalValue: tabSize } }).indent).toBe(4);
    }
    expect(read({ 'editor.insertSpaces': { globalValue: 'false' } }).indent).toBe(4);
  });

  it('reads a key VS Code does not know (no inspect result) as the default', () => {
    expect(effectiveValue(undefined)).toBeUndefined();
    expect(
      settingsFrom(
        () => undefined,
        () => undefined,
      ),
    ).toEqual(DEFAULT_SETTINGS);
  });
});

describe('openingMode (spec 019 M1)', () => {
  it('opens in the value, and a large file in Tree when the value is Text', () => {
    expect(openingMode({ defaultMode: 'tree' }, false)).toBe('tree');
    expect(openingMode({ defaultMode: 'text' }, false)).toBe('text');
    expect(openingMode({ defaultMode: 'table' }, false)).toBe('table');
    expect(openingMode({ defaultMode: 'text' }, true)).toBe('tree');
    expect(openingMode({ defaultMode: 'table' }, true)).toBe('table');
  });
});

describe('pageSettings (019 T2)', () => {
  it('gives the page today’s behavior at the defaults', () => {
    expect(pageSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_EDITOR_SETTINGS);
  });

  it('sends the threshold in bytes and the query language and display settings as set', () => {
    expect(
      pageSettings({
        ...DEFAULT_SETTINGS,
        largeFileThreshold: 6,
        'transform.defaultQueryLanguage': 'lodash',
        'table.flattenColumns': false,
        escapeControlCharacters: true,
        escapeUnicodeCharacters: true,
      }),
    ).toEqual({
      thresholdBytes: 6_291_456,
      defaultQueryLanguage: 'lodash',
      flattenColumns: false,
      escapeControlCharacters: true,
      escapeUnicodeCharacters: true,
    });
  });

  it('sees no change when only a host setting changed', () => {
    const before = pageSettings(DEFAULT_SETTINGS);
    const hostOnly = pageSettings({
      ...DEFAULT_SETTINGS,
      defaultMode: 'text',
      'validation.enable': false,
      'smartFormat.maxLineLength': 60,
      indent: '\t',
    });
    expect(samePageSettings(before, hostOnly)).toBe(true);
    const changed = pageSettings({ ...DEFAULT_SETTINGS, escapeUnicodeCharacters: true });
    expect(samePageSettings(before, changed)).toBe(false);
  });
});
