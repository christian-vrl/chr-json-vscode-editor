// Unit tests for 002 T3 and 002 T6: Style detection, parse diagnostics, pointer handling and the
// edges of the patch operations the golden corpus does not cover.
import { describe, expect, it } from 'vitest';
import {
  detectStyle,
  getAdapter,
  json5Adapter,
  jsonAdapter,
  jsoncAdapter,
  PatchError,
} from '../src/index.js';

describe('detectStyle', () => {
  it('reads two-space indent, LF and a final newline', () => {
    expect(detectStyle('{\n  "a": {\n    "b": 1\n  }\n}\n', 'json')).toEqual({
      indent: 2,
      eol: '\n',
      finalNewline: true,
      quote: '"',
      unquotedKeys: false,
      trailingCommas: false,
    });
  });

  it('reads tabs, CRLF and no final newline', () => {
    const style = detectStyle('{\r\n\t"a": [\r\n\t\t1\r\n\t]\r\n}', 'jsonc');
    expect(style).toMatchObject({ indent: '\t', eol: '\r\n', finalNewline: false });
  });

  it('reads a four-space unit from nested levels', () => {
    expect(detectStyle('{\n    "a": {\n        "b": 1\n    }\n}', 'json').indent).toBe(4);
  });

  it('defaults to two spaces in a file with no line breaks (R1)', () => {
    expect(detectStyle('{"a": [1, 2]}', 'json').indent).toBe(2);
  });

  it('finds trailing commas in JSONC, also before a comment, and never reports them for JSON', () => {
    expect(detectStyle('[1, 2, // two\n]', 'jsonc').trailingCommas).toBe(true);
    expect(detectStyle('[1, 2]', 'jsonc').trailingCommas).toBe(false);
    expect(detectStyle('[1, 2,]', 'json').trailingCommas).toBe(false);
  });

  it('ignores indentation inside block comments', () => {
    expect(detectStyle('{\n  /*\n         x\n  */\n  "a": 1\n}', 'jsonc').indent).toBe(2);
  });
});

describe('parse', () => {
  it('returns data, tree, style and no diagnostics for valid JSON', () => {
    const result = jsonAdapter.parse('{"a": [1, true, null]}');
    expect(result.data).toEqual({ a: [1, true, null] });
    expect(result.tree?.type).toBe('object');
    expect(result.diagnostics).toEqual([]);
  });

  it('reports more warnings than a call can take as arguments (003 T8 review)', () => {
    const n = 200_000;
    const { diagnostics } = getAdapter('json').parse(`[${'0 /**/,'.repeat(n)}0]`);
    expect(diagnostics).toHaveLength(n);
    expect(diagnostics.every((d) => d.severity === 'warning')).toBe(true);
  });

  it('reports comments and trailing commas in JSON as warnings, not errors', () => {
    const result = jsonAdapter.parse('{\n  // c\n  "a": 1,\n}');
    expect(result.data).toEqual({ a: 1 });
    expect(result.diagnostics.map((d) => [d.severity, d.offset])).toEqual([
      ['warning', 4],
      ['warning', 17],
    ]);
  });

  it('accepts comments and trailing commas in JSONC without diagnostics', () => {
    expect(jsoncAdapter.parse('{ /* c */ "a": 1, }').diagnostics).toEqual([]);
  });

  it('reports syntax errors as errors', () => {
    const result = jsoncAdapter.parse('{"a": }');
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});

describe('applyPatch', () => {
  const apply = (text: string, ...patch: Parameters<typeof jsoncAdapter.applyPatch>[1]) =>
    jsoncAdapter.applyPatch(text, patch);

  it('replaces an existing member on add (RFC 6902 §4.1)', () => {
    expect(apply('{"a": 1, "b": 2}', { op: 'add', path: '/a', value: 3 })).toBe('{"a": 3, "b": 2}');
  });

  it('replaces the whole document at the root pointer', () => {
    expect(apply('[1]\n', { op: 'replace', path: '', value: { x: [] } })).toBe('{\n  "x": []\n}\n');
    expect(apply('1', { op: 'add', path: '', value: 'z' })).toBe('"z"');
  });

  it('unescapes ~1 and ~0 in pointers', () => {
    expect(apply('{"a/b": 1, "c~d": 2}', { op: 'replace', path: '/a~1b', value: 0 })).toBe(
      '{"a/b": 0, "c~d": 2}',
    );
    expect(apply('{"a/b": 1, "c~d": 2}', { op: 'remove', path: '/c~0d' })).toBe('{"a/b": 1}');
  });

  it('adds to empty containers', () => {
    expect(apply('{"a": []}', { op: 'add', path: '/a/-', value: 1 })).toBe('{"a": [1]}');
    expect(apply('{\n  "o": {\n  }\n}', { op: 'add', path: '/o/k', value: 1 })).toBe(
      '{\n  "o": {\n    "k": 1\n  }\n}',
    );
  });

  it('appends to a single-line container with a trailing comma', () => {
    expect(apply('[1, 2,]', { op: 'add', path: '/-', value: 3 })).toBe('[1, 2, 3,]');
    expect(apply('[1,2]', { op: 'add', path: '/-', value: 3 })).toBe('[1,2,3]');
  });

  it('removes the last member of a single-line container with a trailing comma', () => {
    expect(apply('[1, 2,]', { op: 'remove', path: '/1' })).toBe('[1,]');
    expect(apply('{"a": 1}', { op: 'remove', path: '/a' })).toBe('{}');
  });

  it('applies operations in order', () => {
    expect(
      apply('{\n  "a": 1\n}\n', { op: 'add', path: '/b', value: 2 }, { op: 'remove', path: '/a' }),
    ).toBe('{\n  "b": 2\n}\n');
  });

  it.each([
    [{ op: 'replace', path: '/missing', value: 1 }],
    [{ op: 'remove', path: '/a/5' }],
    [{ op: 'add', path: '/a/3', value: 1 }],
    [{ op: 'add', path: '/a/01', value: 1 }],
    [{ op: 'add', path: '/x/y', value: 1 }],
    [{ op: 'remove', path: '' }],
    [{ op: 'remove', path: 'a' }],
    [{ op: 'move', from: '/a', path: '/a/0' }],
    [{ op: 'move', from: '', path: '/b' }],
    [{ op: 'move', from: '/b', path: '/c' }],
    [{ op: 'copy', from: '/a/2', path: '/c' }],
    [{ op: 'test', path: '/a/1', value: 3 }],
    [{ op: 'test', path: '/b', value: null }],
  ] as const)('throws a PatchError for %j', (op) => {
    expect(() => apply('{"a": [1, 2]}', op)).toThrow(PatchError);
  });

  it('throws a PatchError on text that does not parse', () => {
    expect(() => apply('{"a": ', { op: 'add', path: '/b', value: 1 })).toThrow(PatchError);
  });

  it('has an adapter for each format', () => {
    for (const format of ['json', 'jsonc', 'json5'] as const)
      expect(getAdapter(format).format).toBe(format);
  });
});

describe('move, copy and test (002 T6)', () => {
  const apply = (text: string, ...patch: Parameters<typeof jsoncAdapter.applyPatch>[1]) =>
    jsoncAdapter.applyPatch(text, patch);

  it('leaves the text unchanged for a move onto itself (RFC 6902 §4.4)', () => {
    expect(apply('{"a": 1}', { op: 'move', from: '/a', path: '/a' })).toBe('{"a": 1}');
  });

  it('moves a member over an existing one, replacing its value', () => {
    expect(apply('{"a": 1, "b": 2}', { op: 'move', from: '/a', path: '/b' })).toBe('{"b": 1}');
  });

  it('moves a member to the root', () => {
    expect(apply('{"a": {"x": [1]}, "b": 2}', { op: 'move', from: '/a', path: '' })).toBe(
      '{"x": [1]}',
    );
  });

  it('re-indents a multi-line value and its comments for their new depth (R1, R7)', () => {
    const text =
      '{\n  "a": {\n    "deep": {\n      // note\n      "x": [\n        1\n      ]\n    }\n  }\n}\n';
    expect(apply(text, { op: 'move', from: '/a/deep', path: '/top' })).toBe(
      '{\n  "a": {\n  },\n  "top": {\n    // note\n    "x": [\n      1\n    ]\n  }\n}\n',
    );
  });

  it('turns a carried line comment into a block comment on a shared line', () => {
    expect(
      apply('{\n  "a": 1, // one\n  "b": [2]\n}', { op: 'move', from: '/a', path: '/b/0' }),
    ).toBe('{\n  "b": [1, /* one */ 2]\n}');
  });

  it('keeps an object member named like a prototype member as data', () => {
    expect(
      apply('{"__proto__": {"x": 1}, "constructor": 2}', {
        op: 'copy',
        from: '/__proto__',
        path: '/c',
      }),
    ).toBe('{"__proto__": {"x": 1}, "constructor": 2, "c": {"x":1}}');
    expect(() => apply('{}', { op: 'test', path: '/constructor', value: 2 })).toThrow(PatchError);
    expect(apply('{"constructor": 2}', { op: 'test', path: '/constructor', value: 2 })).toBe(
      '{"constructor": 2}',
    );
  });

  it('compares objects in any member order and numbers by value (RFC 6902 §4.6)', () => {
    const text = '{"o": {"a": 1, "b": [1.0, {}]}}';
    expect(apply(text, { op: 'test', path: '/o', value: { b: [1, {}], a: 1 } })).toBe(text);
    expect(() => apply(text, { op: 'test', path: '/o', value: { a: 1 } })).toThrow(PatchError);
    expect(() => apply(text, { op: 'test', path: '/o/b', value: { 0: 1, 1: {} } })).toThrow(
      PatchError,
    );
  });

  it('copies data, not comments or literals (README reading 4)', () => {
    expect(
      json5Adapter.applyPatch('[0x0A /* ten */]', [{ op: 'copy', from: '/0', path: '/-' }]),
    ).toBe('[0x0A /* ten */, 10]');
  });

  it('is atomic: a failing operation after others throws, and nothing is returned (R9)', () => {
    const patch = [
      { op: 'add', path: '/b', value: 2 },
      { op: 'test', path: '/b', value: 3 },
    ] as const;
    for (const format of ['json', 'jsonc', 'json5'] as const)
      expect(() => getAdapter(format).applyPatch('{"a": 1}', patch)).toThrow(PatchError);
  });
});

describe('a document with no value (R15, UNK-026)', () => {
  it.each(['json', 'jsonc', 'json5'] as const)(
    '%s: add or replace at "" writes the document',
    (format) => {
      const adapter = getAdapter(format);
      expect(adapter.applyPatch('', [{ op: 'add', path: '', value: [1] }])).toBe('[\n  1\n]\n');
      expect(adapter.applyPatch(' \r\n', [{ op: 'replace', path: '', value: {} }])).toBe('{}\r\n');
    },
  );

  it('writes after the comments, in JSON5 with the quote R4 gives a new file', () => {
    expect(
      json5Adapter.applyPatch('/* a */ // b\n\n', [{ op: 'add', path: '', value: { k: 's' } }]),
    ).toBe('/* a */ // b\n{\n  "k": "s"\n}\n');
  });

  it('then edits the written document like any other', () => {
    expect(
      jsoncAdapter.applyPatch('', [
        { op: 'add', path: '', value: {} },
        { op: 'add', path: '/a', value: 1 },
      ]),
    ).toBe('{"a": 1}\n');
  });

  it.each([
    [{ op: 'add', path: '/a', value: 1 }],
    [{ op: 'remove', path: '' }],
    [{ op: 'test', path: '', value: null }],
    [{ op: 'copy', from: '', path: '' }],
    [{ op: 'move', from: '', path: '' }],
  ] as const)('throws a PatchError for %j', (op) => {
    for (const format of ['json', 'jsonc', 'json5'] as const)
      expect(() => getAdapter(format).applyPatch('// c\n', [op])).toThrow(PatchError);
  });

  it('is not a text whose comment never ends', () => {
    for (const format of ['json', 'jsonc', 'json5'] as const)
      expect(() =>
        getAdapter(format).applyPatch('/* open', [{ op: 'add', path: '', value: 1 }]),
      ).toThrow(/does not parse/);
  });
});
