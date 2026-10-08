// Spec 002 criterion 5: detect(path, languageId?, text?) per R11, table-driven over every listed name.
import { describe, expect, it } from 'vitest';
import { detect, type DetectionSource } from '../src/detect.js';
import type { Format } from '../src/formats/types.js';

type Row = [path: string, languageId: string | undefined, text: string | undefined, format: Format];

// R11 step 1: an explicit languageId wins over everything after it.
const byLanguageId: Row[] = [
  ['data.txt', 'json', undefined, 'json'],
  ['data.txt', 'jsonc', undefined, 'jsonc'],
  ['data.txt', 'json5', undefined, 'json5'],
  ['data.json5', 'json', '{a: 1}', 'json'],
  ['data.json', 'json5', '{"a": 1}', 'json5'],
  ['settings.json', 'json', '{}', 'json'],
];

// R11 step 3: extension.
const byExtension: Row[] = [
  ['data.json', undefined, undefined, 'json'],
  ['data.jsonc', undefined, undefined, 'jsonc'],
  ['data.json5', undefined, undefined, 'json5'],
  ['/home/u/project/package.json', undefined, '// comment\n{}', 'json'],
  ['C:\\Users\\u\\data.jsonc', undefined, '{"a": 1}', 'jsonc'],
  ['data.JSON5', undefined, undefined, 'json5'],
  // Not one of R11's languageIds: falls through to the next step.
  ['data.jsonc', 'plaintext', undefined, 'jsonc'],
];

// R11 step 2: VS Code JSONC file names win over the generic `.json` extension (UNK-019).
const jsoncFileNames = [
  'settings.json',
  'tsconfig.json',
  'jsconfig.json',
  'launch.json',
  'tasks.json',
  'extensions.json',
  'devcontainer.json',
  '.eslintrc.json',
];
const byFileName: Row[] = jsoncFileNames.flatMap((name): Row[] => [
  [name, undefined, undefined, 'jsonc'],
  [`/repo/.vscode/${name}`, undefined, '{"a": 1}', 'jsonc'],
  [`C:\\repo\\${name}`, undefined, undefined, 'jsonc'],
]);

// R11 step 4: content.
const byContent: Row[] = [
  ['untitled:Untitled-1', undefined, '{"a": [1, 2.5e3, true, null, "x"]}', 'json'],
  ['data.txt', undefined, '  42  ', 'json'],
  ['data.txt', undefined, '// header\n{"a": 1}', 'jsonc'],
  ['data.txt', undefined, '{"a": 1 /* inline */}', 'jsonc'],
  ['data.txt', undefined, '{"a": [1, 2,],}', 'jsonc'],
  ['data.txt', undefined, "{'a': 1}", 'json5'],
  ['data.txt', undefined, '{a: 1}', 'json5'],
  ['data.txt', undefined, '{"a": 0x1F}', 'json5'],
  ['data.txt', undefined, '[Infinity, NaN]', 'json5'],
  ['data.txt', undefined, '{"a": ', 'json5'],
  // UNK-020: empty or JSON-whitespace-only text is json; a comment alone is not empty.
  ['data.txt', undefined, '', 'json'],
  ['untitled:Untitled-1', undefined, ' \t\r\n ', 'json'],
  ['', undefined, '\uFEFF', 'json'],
  ['data.txt', undefined, '// only a comment', 'json5'],
  ['data.txt', undefined, '\u00A0', 'json5'],
  ['', undefined, '\ufeff{"a": 1}', 'json'],
  ['README', undefined, '[1, 2]', 'json'],
];

describe('detect (spec 002 R11)', () => {
  const groups: [DetectionSource, Row[]][] = [
    ['languageId', byLanguageId],
    ['extension', byExtension],
    ['fileName', byFileName],
    ['content', byContent],
  ];
  it.each(groups.flatMap(([source, rows]) => rows.map((row) => [...row, source] as const)))(
    'detect(%j, %j, %j) is %s via %s',
    (path, languageId, text, format, source) => {
      const result = detect(path, languageId, text);
      expect(result.format).toBe(format);
      expect(result.source).toBe(source);
    },
  );

  it('covers every name R11 lists', () => {
    const tested = new Set(
      [...byLanguageId, ...byExtension, ...byFileName].flatMap(([p, l]) => [p, l]),
    );
    for (const id of ['json', 'jsonc', 'json5']) expect(tested).toContain(id);
    for (const ext of ['data.json', 'data.jsonc', 'data.json5']) expect(tested).toContain(ext);
    for (const name of jsoncFileNames) expect(tested).toContain(name);
  });

  it('defaults to json when no step applies and there is no text', () => {
    expect(detect('data.txt')).toEqual({ format: 'json', source: 'default', diagnostics: [] });
  });
});

describe('strict-JSON diagnostics', () => {
  it('reports comments and trailing commas in a .json file as warnings, not failures', () => {
    const text = '{\n  // note\n  "a": [1, 2,],\n}';
    const result = detect('data.json', undefined, text);
    expect(result.format).toBe('json');
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);
    for (const d of result.diagnostics) expect(d.severity).toBe('warning');
    const comment = result.diagnostics.find((d) => d.code === 'InvalidCommentToken');
    expect(comment).toBeDefined();
    expect(text.slice(comment!.offset, comment!.offset + comment!.length)).toBe('// note');
  });

  it('reports each trailing comma once, on the comma', () => {
    const text = '{"a": [1, 2 /* c */ ,\n], "b": 1 , }';
    const diagnostics = detect('data.json', undefined, text).diagnostics;
    const trailing = diagnostics.filter((d) => d.code === 'TrailingComma');
    expect(trailing.map((d) => text[d.offset])).toEqual([',', ',']);
    expect(trailing.map((d) => d.offset)).toEqual([
      text.indexOf(' ,\n') + 1,
      text.lastIndexOf(','),
    ]);
    expect(diagnostics.filter((d) => d.code !== 'TrailingComma').map((d) => d.code)).toEqual([
      'InvalidCommentToken',
    ]);
    for (const d of trailing) expect(d.message).toBe('Trailing commas are not allowed in JSON.');
  });

  it('shifts offsets past a leading byte order mark', () => {
    const [d] = detect('data.json', undefined, '\uFEFF[1,]').diagnostics;
    expect(d).toMatchObject({ code: 'TrailingComma', offset: 3 });
  });

  it('reports nothing for valid JSON, for non-json formats, or without text', () => {
    expect(detect('data.json', undefined, '{"a": 1}').diagnostics).toEqual([]);
    expect(detect('data.jsonc', undefined, '// c\n{"a": 1,}').diagnostics).toEqual([]);
    expect(detect('settings.json', undefined, '// c\n{}').diagnostics).toEqual([]);
    expect(detect('data.json').diagnostics).toEqual([]);
  });

  // Falsifiability check: strict diagnostics are empty exactly when JSON.parse accepts the text.
  const samples = [
    '{}',
    '[]',
    '-0',
    'true',
    '"\u2028"',
    '{"a":{"b":[1,2,{"c":null}]}}',
    ' 1e10 ',
    '',
    '  ',
    '01',
    '1.',
    '.5',
    '-',
    '"\t"',
    '"\\x"',
    '+1',
    '[1,]',
    '{"a":1,}',
    '// c\n{}',
    "{'a':1}",
    '{a:1}',
    'NaN',
    'Infinity',
    '0x1F',
    '1 2',
    '{"a":1}}',
    '[1 2]',
    '{"a" 1}',
    '"\\u12"',
    '1e',
    'nul',
    '"abc',
    '/* x */1',
    '1/*x*/',
  ];
  it.each(samples)('agrees with JSON.parse on %j', (text) => {
    let accepted = true;
    try {
      JSON.parse(text);
    } catch {
      accepted = false;
    }
    expect(detect('data.json', undefined, text).diagnostics.length === 0).toBe(accepted);
  });
});
