// Unit tests for 002 T3: Style detection, parse diagnostics, pointer handling and the edges of the
// JSON/JSONC primitives the golden corpus does not cover.
import { describe, expect, it } from 'vitest';
import { detectStyle, getAdapter, jsonAdapter, jsoncAdapter, PatchError } from '../src/index.js';

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
    [{ op: 'move', from: '/a', path: '/b' }],
  ] as const)('throws a PatchError for %j', (op) => {
    expect(() => apply('{"a": [1, 2]}', op)).toThrow(PatchError);
  });

  it('throws a PatchError on text that does not parse', () => {
    expect(() => apply('{"a": ', { op: 'add', path: '/b', value: 1 })).toThrow(PatchError);
  });

  it('has no JSON5 adapter until 002 T5', () => {
    expect(() => getAdapter('json5')).toThrow(/002 T5/);
  });
});
