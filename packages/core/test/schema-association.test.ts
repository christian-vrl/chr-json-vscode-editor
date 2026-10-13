// Gate test for 004 T3 (spec 004 criterion 1): one table row per association rule, first match wins:
// the document's `$schema` when it is a local path → `json.schemas` → `json5.schemas` → none.
import { describe, expect, it } from 'vitest';
import {
  fileMatchSelects,
  globToRegExp,
  localSchemaPath,
  resolveSchemaAssociation,
  type SchemaAssociation,
  type SchemaAssociationInput,
} from '../src/index.js';

const DOC = 'file:///work/proj/config/app.json';
const WORKSPACE = { baseUri: 'file:///work/proj' };
const inlineSchema = { type: 'object' };

const rows: {
  rule: string;
  input: Omit<SchemaAssociationInput, 'documentUri'>;
  expected: SchemaAssociation;
}[] = [
  // Rule 1: the document's own $schema, when it is a local path.
  {
    rule: '$schema relative path resolves against the document folder',
    input: { documentSchema: './app.schema.json' },
    expected: {
      source: '$schema',
      location: { kind: 'file', uri: 'file:///work/proj/config/app.schema.json' },
    },
  },
  {
    rule: '$schema relative path with .. climbs out of the document folder',
    input: { documentSchema: '../schemas/app.json' },
    expected: {
      source: '$schema',
      location: { kind: 'file', uri: 'file:///work/proj/schemas/app.json' },
    },
  },
  {
    rule: '$schema bare file name is relative',
    input: { documentSchema: 'app.schema.json' },
    expected: {
      source: '$schema',
      location: { kind: 'file', uri: 'file:///work/proj/config/app.schema.json' },
    },
  },
  {
    rule: '$schema absolute POSIX path',
    input: { documentSchema: '/etc/schemas/app.json' },
    expected: {
      source: '$schema',
      location: { kind: 'file', uri: 'file:///etc/schemas/app.json' },
    },
  },
  {
    rule: '$schema absolute Windows path',
    input: { documentSchema: 'C:\\schemas\\app.json' },
    expected: { source: '$schema', location: { kind: 'file', uri: 'file:///c:/schemas/app.json' } },
  },
  {
    rule: '$schema file: URI',
    input: { documentSchema: 'file:///etc/schemas/app.json' },
    expected: {
      source: '$schema',
      location: { kind: 'file', uri: 'file:///etc/schemas/app.json' },
    },
  },
  {
    rule: '$schema wins over a matching json.schemas entry',
    input: {
      documentSchema: './app.schema.json',
      jsonSchemas: [{ ...WORKSPACE, entries: [{ fileMatch: ['app.json'], url: './other.json' }] }],
    },
    expected: {
      source: '$schema',
      location: { kind: 'file', uri: 'file:///work/proj/config/app.schema.json' },
    },
  },
  // Rule 2: json.schemas (fileMatch).
  {
    rule: 'remote $schema (a meta-schema id) is not a local path, so json.schemas applies',
    input: {
      documentSchema: 'http://json-schema.org/draft-07/schema#',
      jsonSchemas: [
        { ...WORKSPACE, entries: [{ fileMatch: ['app.json'], url: './schemas/app.json' }] },
      ],
    },
    expected: {
      source: 'json.schemas',
      location: { kind: 'file', uri: 'file:///work/proj/schemas/app.json' },
    },
  },
  {
    rule: 'non-string or empty $schema is ignored',
    input: {
      documentSchema: 42,
      jsonSchemas: [
        { ...WORKSPACE, entries: [{ fileMatch: ['/config/*.json'], url: '/schemas/app.json' }] },
      ],
    },
    expected: {
      source: 'json.schemas',
      location: { kind: 'file', uri: 'file:///work/proj/schemas/app.json' },
    },
  },
  {
    rule: 'json.schemas inline schema',
    input: {
      jsonSchemas: [{ entries: [{ fileMatch: ['**/config/*.json'], schema: inlineSchema }] }],
    },
    expected: { source: 'json.schemas', location: { kind: 'inline', schema: inlineSchema } },
  },
  {
    rule: 'json.schemas remote url is named, never fetched',
    input: {
      jsonSchemas: [{ entries: [{ fileMatch: ['app.json'], url: 'https://example.com/s.json' }] }],
    },
    expected: {
      source: 'json.schemas',
      location: { kind: 'remote', uri: 'https://example.com/s.json' },
    },
  },
  {
    rule: 'json.schemas: the first matching entry wins, in settings order',
    input: {
      jsonSchemas: [
        {
          entries: [
            { fileMatch: ['other.json'], url: '/a.json' },
            { fileMatch: ['*.json'], url: '/b.json' },
          ],
        },
        { ...WORKSPACE, entries: [{ fileMatch: ['app.json'], url: './c.json' }] },
      ],
    },
    expected: { source: 'json.schemas', location: { kind: 'file', uri: 'file:///b.json' } },
  },
  // Rule 3: json5.schemas, only when nothing above matched.
  {
    rule: 'json.schemas wins over json5.schemas',
    input: {
      jsonSchemas: [{ entries: [{ fileMatch: ['app.json'], url: '/from-json.json' }] }],
      json5Schemas: [{ entries: [{ fileMatch: ['app.json'], url: '/from-json5.json' }] }],
    },
    expected: { source: 'json.schemas', location: { kind: 'file', uri: 'file:///from-json.json' } },
  },
  {
    rule: 'json5.schemas applies when json.schemas does not match',
    input: {
      jsonSchemas: [{ entries: [{ fileMatch: ['*.json5'], url: '/from-json.json' }] }],
      json5Schemas: [
        { ...WORKSPACE, entries: [{ fileMatch: ['config/app.json'], url: './s/app.json' }] },
      ],
    },
    expected: {
      source: 'json5.schemas',
      location: { kind: 'file', uri: 'file:///work/proj/s/app.json' },
    },
  },
  // Rule 4: none.
  {
    rule: 'no $schema and no matching setting gives none',
    input: {
      documentSchema: 'https://example.com/schema.json',
      jsonSchemas: [{ entries: [{ fileMatch: ['*.json5'], url: '/x.json' }] }],
      json5Schemas: [{ entries: [{ fileMatch: ['other.json'], url: '/y.json' }] }],
    },
    expected: { source: 'none' },
  },
  {
    rule: 'no inputs at all gives none',
    input: {},
    expected: { source: 'none' },
  },
];

describe('resolveSchemaAssociation (criterion 1)', () => {
  it.each(rows)('$rule', ({ input, expected }) => {
    expect(resolveSchemaAssociation({ documentUri: DOC, ...input })).toEqual(expected);
  });
});

describe('settings scopes', () => {
  const folderScope = {
    baseUri: 'file:///work/proj',
    folderUri: 'file:///work/proj',
    entries: [{ fileMatch: ['*.json'], url: './s.json' }],
  };

  it('applies workspace-folder entries only inside that folder', () => {
    expect(resolveSchemaAssociation({ documentUri: DOC, jsonSchemas: [folderScope] })).toEqual({
      source: 'json.schemas',
      location: { kind: 'file', uri: 'file:///work/proj/s.json' },
    });
    expect(
      resolveSchemaAssociation({
        documentUri: 'file:///work/project2/a.json',
        jsonSchemas: [folderScope],
      }),
    ).toEqual({ source: 'none' });
  });

  it('skips malformed entries and levels', () => {
    const scopes = [
      { entries: 'not an array' },
      {
        entries: [
          null,
          'x',
          { fileMatch: 'app.json', url: '/a.json' },
          { fileMatch: ['app.json'] },
        ],
      },
      { entries: [{ fileMatch: ['app.json'], url: '/ok.json' }] },
    ];
    expect(resolveSchemaAssociation({ documentUri: DOC, jsonSchemas: scopes })).toEqual({
      source: 'json.schemas',
      location: { kind: 'file', uri: 'file:///ok.json' },
    });
  });

  it('skips a relative url in user settings, which has no folder to resolve against', () => {
    const scopes = [
      { entries: [{ fileMatch: ['app.json'], url: './s.json' }] },
      { entries: [{ fileMatch: ['app.json'], url: 'file:///ok.json' }] },
    ];
    expect(resolveSchemaAssociation({ documentUri: DOC, jsonSchemas: scopes })).toEqual({
      source: 'json.schemas',
      location: { kind: 'file', uri: 'file:///ok.json' },
    });
  });

  it('keeps the url next to an inline schema and resolves user-level absolute paths', () => {
    expect(
      resolveSchemaAssociation({
        documentUri: DOC,
        jsonSchemas: [
          { entries: [{ fileMatch: ['app.json'], url: 'C:/s/app.json', schema: inlineSchema }] },
        ],
      }),
    ).toEqual({
      source: 'json.schemas',
      location: { kind: 'inline', schema: inlineSchema, uri: 'file:///c:/s/app.json' },
    });
  });
});

describe('localSchemaPath', () => {
  it.each([
    ['./a.json#/definitions/x', 'file:///work/proj/config/a.json'],
    ['sub\\a.json', 'file:///work/proj/config/sub/a.json'],
    ['../../../../a.json', 'file:///a.json'],
    ['FILE:///C:/x/../a.json', 'file:///c:/a.json'],
    ['\\\\Server\\share\\a.json', 'file://server/share/a.json'],
    ['  ./a.json  ', 'file:///work/proj/config/a.json'],
  ])('%s → %s', (value, expected) => {
    expect(localSchemaPath(value, DOC)).toBe(expected);
  });

  it.each([[''], ['#'], ['https://x/s.json'], ['vscode://schemas/settings'], [null], [{}]])(
    'rejects %j',
    (value) => {
      expect(localSchemaPath(value, DOC)).toBeUndefined();
    },
  );

  it('does not resolve a relative path for an untitled document', () => {
    expect(localSchemaPath('./a.json', 'untitled:Untitled-1')).toBeUndefined();
  });
});

describe('fileMatchSelects (VS Code fileMatch rules)', () => {
  it.each([
    [['app.json'], true],
    [['/app.json'], true],
    [['config/app.json'], true],
    [['/config/app.json'], true],
    [['*.json'], true],
    [['**/*.json'], true],
    [['proj/**/app.json'], true],
    [['proj/*/app.json'], true],
    [['work/*.json'], false],
    [['*.{json,jsonc}'], true],
    [['ap?.json'], true],
    [['[ab]pp.json'], true],
    [['pp.json'], false],
    [['app.jsonc'], false],
    [['*.json', '!config/*'], false],
    [['!config/*', '*.json'], true],
    [['*.json', '!other.json'], true],
    [['!app.json'], false],
    [['', '!'], false],
    [['[app.json', '*.json'], false],
    ['app.json', false],
    [[1, 'app.json'], true],
  ])('%j → %s', (patterns, expected) => {
    expect(fileMatchSelects(patterns, DOC)).toBe(expected);
  });

  it('treats regex characters in patterns literally', () => {
    expect(globToRegExp('a+(b).json').test('a+(b).json')).toBe(true);
    expect(globToRegExp('a.json').test('abjson')).toBe(false);
  });
});

// Gate test for 013 T3 (spec 013 criterion 6): schema files on virtual schemes (github.dev's
// `vscode-vfs:`, the web test harness's `vscode-test-web:`) resolve against the document's or
// folder's own scheme and authority. `file:` results are the rows above, unchanged.
describe('virtual schemes (spec 013 criterion 6)', () => {
  const VFS_DOC = 'vscode-vfs://github/o/r/data/a.json';
  const VFS_FOLDER = { baseUri: 'vscode-vfs://github/o/r', folderUri: 'vscode-vfs://github/o/r' };

  it.each([
    ['./s.json', 'vscode-vfs://github/o/r/data/s.json'],
    ['s.json', 'vscode-vfs://github/o/r/data/s.json'],
    ['../schemas/s.json#/definitions/x', 'vscode-vfs://github/o/r/schemas/s.json'],
    ['sub\\s.json', 'vscode-vfs://github/o/r/data/sub/s.json'],
  ])('relative $schema %s → %s', (value, expected) => {
    expect(resolveSchemaAssociation({ documentUri: VFS_DOC, documentSchema: value })).toEqual({
      source: '$schema',
      location: { kind: 'file', uri: expected },
    });
  });

  // 013 T4: an absolute path names a file on the document's own scheme and authority, as VS Code's
  // JSON service resolves it; on `file:` it stays `file:` (the rows above, unchanged).
  it.each([
    ['/s.json', VFS_DOC, 'vscode-vfs://github/s.json'],
    ['/schemas/../s.json#/x', VFS_DOC, 'vscode-vfs://github/s.json'],
    ['\\schemas\\s.json', VFS_DOC, 'vscode-vfs://github/schemas/s.json'],
    [
      '/fixtures/s.json',
      'vscode-test-web://mount/work/a.json',
      'vscode-test-web://mount/fixtures/s.json',
    ],
    ['/s.json', 'memfs:/work/a.json', 'memfs:/s.json'],
    ['/s.json', 'file:///work/a.json', 'file:///s.json'],
    ['/s.json', 'file://server/share/a.json', 'file:///s.json'],
    ['/s.json', 'untitled:/work/a.json', 'file:///s.json'],
  ])('absolute $schema %s on %s → %s', (value, documentUri, expected) => {
    expect(localSchemaPath(value, documentUri)).toBe(expected);
  });

  it("keeps the test harness's scheme and authority", () => {
    expect(localSchemaPath('./s.json', 'vscode-test-web://mount/validation/person.json')).toBe(
      'vscode-test-web://mount/validation/s.json',
    );
  });

  it('resolves against a scheme with no authority', () => {
    expect(localSchemaPath('../s.json', 'memfs:/work/data/a.json')).toBe('memfs:/work/s.json');
  });

  it('ignores the query and fragment of the document URI', () => {
    expect(localSchemaPath('./s.json', 'vscode-vfs://github/o/r/data/a.json?ref=main#x')).toBe(
      'vscode-vfs://github/o/r/data/s.json',
    );
  });

  it('does not resolve a relative $schema against an http(s) document, which stays remote', () => {
    expect(localSchemaPath('./s.json', 'https://example.com/data/a.json')).toBeUndefined();
    expect(localSchemaPath('./s.json', 'HTTP://example.com/data/a.json')).toBeUndefined();
  });

  it('does not resolve a relative $schema for an untitled document with a path', () => {
    expect(localSchemaPath('./s.json', 'untitled:/work/a.json')).toBeUndefined();
  });

  it('resolves a json.schemas url relative to a virtual workspace folder', () => {
    expect(
      resolveSchemaAssociation({
        documentUri: VFS_DOC,
        jsonSchemas: [
          { ...VFS_FOLDER, entries: [{ fileMatch: ['data/*.json'], url: './s.json' }] },
        ],
      }),
    ).toEqual({
      source: 'json.schemas',
      location: { kind: 'file', uri: 'vscode-vfs://github/o/r/s.json' },
    });
    expect(
      resolveSchemaAssociation({
        documentUri: VFS_DOC,
        json5Schemas: [
          { ...VFS_FOLDER, entries: [{ fileMatch: ['a.json'], url: '/schemas/../s.json' }] },
        ],
      }),
    ).toEqual({
      source: 'json5.schemas',
      location: { kind: 'file', uri: 'vscode-vfs://github/o/r/s.json' },
    });
  });

  it('keeps http(s) setting urls remote on a virtual workspace', () => {
    expect(
      resolveSchemaAssociation({
        documentUri: VFS_DOC,
        jsonSchemas: [
          {
            ...VFS_FOLDER,
            entries: [{ fileMatch: ['a.json'], url: 'https://example.com/s.json' }],
          },
        ],
      }),
    ).toEqual({
      source: 'json.schemas',
      location: { kind: 'remote', uri: 'https://example.com/s.json' },
    });
    expect(localSchemaPath('https://example.com/s.json', VFS_DOC)).toBeUndefined();
  });

  it('keeps a url relative to an http(s) settings location remote', () => {
    expect(
      resolveSchemaAssociation({
        documentUri: 'https://example.com/w/a.json',
        jsonSchemas: [
          {
            baseUri: 'https://example.com/w',
            entries: [{ fileMatch: ['a.json'], url: './s.json' }],
          },
        ],
      }),
    ).toEqual({
      source: 'json.schemas',
      location: { kind: 'remote', uri: 'https://example.com/w/s.json' },
    });
  });

  it("applies a virtual folder's entries only inside that folder", () => {
    expect(
      resolveSchemaAssociation({
        documentUri: 'vscode-vfs://github/o/other/a.json',
        jsonSchemas: [{ ...VFS_FOLDER, entries: [{ fileMatch: ['*.json'], url: './s.json' }] }],
      }),
    ).toEqual({ source: 'none' });
  });
});
