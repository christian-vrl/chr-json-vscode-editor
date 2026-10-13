// 002 T7: `stringify(data, format, style)`. The gate is spec 002 criterion 6: `parse(stringify(x,
// format, style)).data` deep-equals `x` over the property generator (`arbitraries.ts`).
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { getAdapter, jsonAdapter, jsoncAdapter, stringify, type Style } from '../src/index.js';
import { dataArbitrary, SEED, styleArbitrary } from './arbitraries.js';
import { readBack } from './read-back.js';

const RUNS = 10_000;

/** Deep equality on own members and prototypes, with `Object.is` on numbers (so -0 and NaN count).
 *  Vitest's `toStrictEqual` also compares `.constructor`, which an own `constructor` member hides. */
function expectSameData(actual: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(actual, expected)) expect(actual).toEqual(expected);
  expect(isDeepStrictEqual(actual, expected)).toBe(true);
}

const style = (overrides: Partial<Style> = {}): Style => ({
  indent: 2,
  eol: '\n',
  finalNewline: true,
  quote: '"',
  unquotedKeys: false,
  trailingCommas: false,
  ...overrides,
});

describe('criterion 6: parse(stringify(x, format, style)).data deep-equals x', () => {
  for (const format of ['json', 'jsonc', 'json5'] as const) {
    it(`${format}: ${RUNS} runs, seed ${SEED}`, () => {
      fc.assert(
        fc.property(dataArbitrary(format), styleArbitrary, (data, s) => {
          const text = stringify(data, format, s);
          const parsed = getAdapter(format).parse(text);
          expect(parsed.diagnostics).toEqual([]);
          expectSameData(parsed.data, readBack(data));
          // The format's reference parser agrees: JSON.parse, and the json5 package (the reference
          // the golden corpus uses for criterion 2).
          if (format === 'json') expectSameData(JSON.parse(text), data);
          if (format === 'json5') expectSameData(JSON5.parse(text), data);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    });
  }

  it('json with no final newline and a space indent is JSON.stringify with that indent', () => {
    fc.assert(
      fc.property(dataArbitrary('json'), fc.integer({ min: 0, max: 8 }), (data, indent) => {
        fc.pre(!hasNegativeZero(data));
        expect(stringify(data, 'json', style({ indent, finalNewline: false }))).toBe(
          JSON.stringify(data, null, indent),
        );
      }),
      { seed: SEED, numRuns: 1_000 },
    );
  });
});

function hasNegativeZero(data: unknown): boolean {
  if (Object.is(data, -0)) return true;
  if (data !== null && typeof data === 'object') return Object.values(data).some(hasNegativeZero);
  return false;
}

describe('stringify layout', () => {
  const data = { a: [1, 'two'], b: {}, c: [], d: { e: null } };

  it('writes JSON like JSON.stringify, with a final newline', () => {
    expect(stringify(data, 'json', style())).toBe(JSON.stringify(data, null, 2) + '\n');
  });

  it('uses tabs and CRLF', () => {
    expect(stringify({ a: [1] }, 'jsonc', style({ indent: '\t', eol: '\r\n' }))).toBe(
      '{\r\n\t"a": [\r\n\t\t1\r\n\t]\r\n}\r\n',
    );
  });

  it('writes indent 0 on one line', () => {
    expect(stringify(data, 'jsonc', style({ indent: 0, trailingCommas: true }))).toBe(
      '{"a":[1,"two"],"b":{},"c":[],"d":{"e":null}}\n',
    );
  });

  it('writes scalars at the root', () => {
    expect(stringify('x', 'json', style({ finalNewline: false }))).toBe('"x"');
    expect(stringify(null, 'json5', style())).toBe('null\n');
  });

  it('adds trailing commas to multi-line containers in JSONC and JSON5, never in JSON', () => {
    const s = style({ trailingCommas: true });
    expect(stringify({ a: [1] }, 'jsonc', s)).toBe('{\n  "a": [\n    1,\n  ],\n}\n');
    expect(stringify({ a: [1] }, 'json', s)).toBe('{\n  "a": [\n    1\n  ]\n}\n');
    expect(stringify({ a: [] }, 'json5', s)).toBe('{\n  "a": [],\n}\n');
  });

  it('writes JSON5 with single quotes, unquoted identifier keys and trailing commas', () => {
    const s = style({ quote: "'", unquotedKeys: true, trailingCommas: true });
    expect(
      stringify({ name: "it's", 'a-b': 'say "hi"', $_1: '\\"', true: 1, é: 2 }, 'json5', s),
    ).toBe(
      [
        '{',
        "  name: 'it\\'s',",
        `  'a-b': 'say "hi"',`,
        "  $_1: '\\\\\"',",
        '  true: 1,',
        "  'é': 2,",
        '}',
        '',
      ].join('\n'),
    );
  });

  it('escapes U+2028 and U+2029 in JSON5 strings only', () => {
    const s = style({ indent: 0, finalNewline: false });
    expect(stringify('a\u2028b\u2029', 'json5', s)).toBe('"a\\u2028b\\u2029"');
    expect(stringify('a\u2028', 'json', s)).toBe('"a\u2028"');
  });

  it('keeps JSON and JSONC double-quoted with quoted keys whatever the style says', () => {
    const s = style({ quote: "'", unquotedKeys: true, indent: 0, finalNewline: false });
    expect(stringify({ a: "'" }, 'json', s)).toBe(`{"a":"'"}`);
    expect(stringify({ a: "'" }, 'jsonc', s)).toBe(`{"a":"'"}`);
  });

  it('writes -0 as -0 and JSON5 non-finite numbers as literals', () => {
    const s = style({ indent: 0, finalNewline: false });
    expect(stringify([-0, 0], 'json', s)).toBe('[-0,0]');
    expect(stringify([Infinity, -Infinity, NaN], 'json5', s)).toBe('[Infinity,-Infinity,NaN]');
  });

  it('throws on values the format cannot hold', () => {
    expect(() => stringify(NaN, 'json', style())).toThrow(TypeError);
    expect(() => stringify([Infinity], 'jsonc', style())).toThrow(TypeError);
    expect(() => stringify({ a: undefined }, 'json5', style())).toThrow(TypeError);
    // A hole in a sparse array reads as undefined.
    // eslint-disable-next-line no-sparse-arrays
    expect(() => stringify([1, , 2], 'json', style())).toThrow(TypeError);
  });

  it('writes a BigInt as its digits in every format (spec 015 B2)', () => {
    const one = style({ indent: 0, finalNewline: false });
    for (const format of ['json', 'jsonc', 'json5'] as const)
      expect(stringify([1n, -12345678901234567890n], format, one)).toBe(
        '[1,-12345678901234567890]',
      );
  });

  it('writes a __proto__ member as a member, and parse reads it back as one', () => {
    const data = JSON.parse('{"__proto__": {"a": 1}}') as unknown;
    const text = stringify(data, 'json', style({ indent: 0, finalNewline: false }));
    expect(text).toBe('{"__proto__":{"a":1}}');
    const parsed = jsonAdapter.parse(text).data as object;
    expect(Object.keys(parsed)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expectSameData(parsed, data);
  });

  it('is what the JSON and JSONC adapters write', () => {
    const s = style({ trailingCommas: true });
    expect(jsonAdapter.stringify(data, s)).toBe(stringify(data, 'json', s));
    expect(jsoncAdapter.stringify(data, s)).toBe(stringify(data, 'jsonc', s));
  });
});
