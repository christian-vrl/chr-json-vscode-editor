// The library's `parser` prop backed by core (003 T5, criterion 10).
import { getAdapter } from '@chr-json-editor/core';
import { describe, expect, it } from 'vitest';
import { parserFor } from '../src/parser.js';

describe('parserFor', () => {
  it('reads JSONC comments and trailing commas as data', () => {
    expect(parserFor('jsonc').parse('{\n  // c\n  "a": [1, 2,], /* d */\n}')).toEqual({
      a: [1, 2],
    });
  });

  it('reads JSON5 syntax', () => {
    expect(parserFor('json5').parse("{a: 'b', h: 0x10, n: +1,}")).toEqual({ a: 'b', h: 16, n: 1 });
  });

  it('keeps warnings for JSON (comments are strict-JSON warnings, not errors)', () => {
    expect(parserFor('json').parse('{"a": 1 // c\n}')).toEqual({ a: 1 });
  });

  it.each([
    ['json', '{"a": }'],
    ['jsonc', '[1 2'],
    // 002 T5 F1: a JSON5 syntax error gives data undefined and one error diagnostic.
    ['json5', '{a: }'],
    ['json5', ''],
  ] as const)('throws for %s that does not parse: %j', (format, text) => {
    expect(() => parserFor(format).parse(text)).toThrow(SyntaxError);
  });

  // Strict JSON skips core (JSON.parse, UNK-014): the data must be what core gives.
  it.each([
    '{"a": [1, -0, 1e400, 0.1, -1.5e-7, 12345678901234567890], "b": {"c": null, "d": true}}',
    '{"__proto__": {"x": 1}, "constructor": 2, "toString": "s", "a": 1, "a": 2}',
    '["\\u00e9\\ud83d\\ude00", "\\ud800", "tab\\tline\\n", "\u2028\u2029", "ünï"]',
    '"just a string"',
    '\n  42  \n',
    '[]',
  ])('reads strict JSON as core does: %s', (text) => {
    for (const format of ['json', 'jsonc', 'json5'] as const) {
      const data = parserFor(format).parse(text);
      expect(data, format).toStrictEqual(getAdapter(format).parse(text).data);
      if (text.includes('__proto__')) {
        expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
        expect(Object.keys(data as object)).toContain('__proto__');
      }
    }
  });

  it('stringifies like JSON.stringify and returns one parser per format', () => {
    expect(parserFor('json5').stringify({ a: [1] }, null, 2)).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(parserFor('jsonc')).toBe(parserFor('jsonc'));
    expect(parserFor('jsonc')).not.toBe(parserFor('json'));
  });
});

// Large-file tabs (spec 008 criterion 8) read the data alone with core's `parseData`.
describe('parserFor(format, large)', () => {
  it.each([
    ['json', '{"a": [1, 2]}', { a: [1, 2] }],
    ['jsonc', '{\n  // c\n  "a": [1, 2,],\n}', { a: [1, 2] }],
    ['json5', "{a: 'b', h: 0x10,}", { a: 'b', h: 16 }],
  ] as const)('reads %s as the normal parser does', (format, text, data) => {
    expect(parserFor(format, true).parse(text)).toEqual(data);
    expect(parserFor(format, true).parse(text)).toEqual(parserFor(format).parse(text));
  });

  it.each([
    ['json', '{"a": }'],
    ['jsonc', '[1 2'],
    ['json5', '{a: }'],
    ['json5', ''],
    ['jsonc', '  '],
  ] as const)('throws for %s that does not parse: %j', (format, text) => {
    expect(() => parserFor(format, true).parse(text)).toThrow(SyntaxError);
  });

  it('is its own object per format, kept until asked for another', () => {
    expect(parserFor('jsonc', true)).toBe(parserFor('jsonc', true));
    expect(parserFor('jsonc', true)).not.toBe(parserFor('jsonc'));
  });
});
