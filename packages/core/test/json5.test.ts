// 002 T5: the JSON5 parser and adapter (ADR-009). Conformance runs over json5-tests @ ceb24d4
// (vendored in fixtures/json5-tests, MIT) with the `json5` package as the data reference; the cases
// ADR-009 names (reserved-word keys, `\u`-escaped keys, astral characters, U+2028 in strings) and
// the edges the golden corpus leaves out are tested directly.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import {
  detectStyle,
  json5Adapter,
  nearestNumbers,
  PatchError,
  stringify,
  type FormatNode,
} from '../src/index.js';
import { parseJson5 } from '../src/formats/json5-parser.js';
import { dataArbitrary, SEED, styleArbitrary } from './arbitraries.js';

const corpus = fileURLToPath(new URL('fixtures/json5-tests/', import.meta.url));
const files = fs
  .readdirSync(corpus, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) =>
    fs
      .readdirSync(path.join(corpus, d.name))
      .filter((f) => /\.(json|json5|js|txt)$/.test(f))
      .map((f) => `${d.name}/${f}`),
  )
  .sort();

/** Every token is contiguous with the next and they cover the whole text. */
function expectTokensCoverText(text: string): void {
  const { tokens } = parseJson5(text);
  let at = 0;
  for (const t of tokens) {
    expect(t.offset).toBe(at);
    expect(t.end).toBeGreaterThan(t.offset);
    at = t.end;
  }
  expect(at).toBe(text.length);
}

/** Each node's span holds its source: a scalar re-parses to its value, a key to its name. */
function expectSpans(text: string, node: FormatNode): void {
  const source = text.slice(node.offset, node.offset + node.length);
  if (node.type === 'property') {
    const [key, value] = node.children!;
    expect(source.startsWith(text.slice(key!.offset, key!.offset + key!.length))).toBe(true);
    expect(source.endsWith(text.slice(value!.offset, value!.offset + value!.length))).toBe(true);
    expectSpans(text, value!);
  } else if (node.type === 'object' || node.type === 'array') {
    expect(source[0]).toBe(node.type === 'object' ? '{' : '[');
    for (const child of node.children!) expectSpans(text, child);
  } else {
    expect(Object.is(JSON5.parse(source), node.value)).toBe(true);
  }
}

describe('conformance: json5-tests @ ceb24d4', () => {
  it('has the 112 upstream cases', () => {
    expect(files).toHaveLength(112);
  });

  it.each(files.filter((f) => /\.json5?$/.test(f)))('parses %s like the json5 package', (f) => {
    const text = fs.readFileSync(path.join(corpus, f), 'utf8');
    const result = json5Adapter.parse(text);
    expect(result.diagnostics).toEqual([]);
    expect(isDeepStrictEqual(result.data, JSON5.parse(text))).toBe(true);
    expectTokensCoverText(text);
    expectSpans(text, result.tree!);
  });

  it.each(files.filter((f) => /\.(js|txt)$/.test(f)))('rejects %s', (f) => {
    const text = fs.readFileSync(path.join(corpus, f), 'utf8');
    const result = json5Adapter.parse(text);
    expect(result.data).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.severity).toBe('error');
  });
});

describe('parse', () => {
  const data = (text: string) => json5Adapter.parse(text).data;

  it('reads reserved words as unquoted keys', () => {
    expect(data('{null: 1, true: 2, if: 3, Infinity: 4, NaN: 5}')).toEqual({
      null: 1,
      true: 2,
      if: 3,
      Infinity: 4,
      NaN: 5,
    });
  });

  it('decodes \\u escapes in unquoted keys and rejects ones that are not identifier characters', () => {
    expect(data('{\\u0061b: 1, a\\u0062c: 2, $\\u005f: 3}')).toEqual({ ab: 1, abc: 2, $_: 3 });
    expect(data('{\\u0020: 1}')).toBeUndefined();
    expect(data('{a\\u002d: 1}')).toBeUndefined();
    expect(data('{\\u00: 1}')).toBeUndefined();
  });

  it('reads astral characters in keys and strings with UTF-16 offsets', () => {
    const text = "{𝑥: '😀', b: 1}";
    const result = json5Adapter.parse(text);
    expect(result.data).toEqual({ '𝑥': '😀', b: 1 });
    const [x, b] = result.tree!.children!;
    expect(x!.children![0]!.length).toBe(2);
    expect(x!.children![1]).toMatchObject({ offset: 5, length: 4, value: '😀' });
    expect(b!.offset).toBe(11);
    expect(data('{😀: 1}')).toBeUndefined();
  });

  it('keeps U+2028 and U+2029 in strings, and reads them as line terminators outside', () => {
    expect(data("'a\u2028b\u2029c'")).toBe('a\u2028b\u2029c');
    expect(data('[1,\u20282,\u2029 3]')).toEqual([1, 2, 3]);
    expect(data("'a\\\u2028b'")).toBe('ab');
    expect(data('// c\u2028 1')).toBe(1);
  });

  it('reads line continuations for LF, CR and CRLF', () => {
    expect(data("'a\\\nb\\\rc\\\r\nd'")).toBe('abcd');
  });

  it('reads JSON5 numbers', () => {
    expect(data('[0x1F, -0x10, +1, .5, 5., -.5e1, Infinity, -Infinity, NaN, -0]')).toEqual([
      31,
      -16,
      1,
      0.5,
      5,
      -5,
      Infinity,
      -Infinity,
      NaN,
      -0,
    ]);
    for (const bad of ['01', '1.2.3', '0x', '1e', '+', '1a', '0xG', 'infinity', '- 1'])
      expect(data(bad), bad).toBeUndefined();
  });

  it('defines a __proto__ key as a member, and a later duplicate wins in place', () => {
    const value = data('{__proto__: 1, a: 2, a: 3}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value)).toEqual(['__proto__', 'a']);
    expect(value.a).toBe(3);
  });

  it('reports the first syntax error with its offset and keeps no data', () => {
    expect(json5Adapter.parse("{a: 'x' b: 1}")).toMatchObject({
      data: undefined,
      tree: undefined,
      diagnostics: [{ severity: 'error', offset: 8, length: 1 }],
    });
    expect(json5Adapter.parse('').diagnostics).toMatchObject([{ offset: 0, length: 0 }]);
    expect(json5Adapter.parse('[1, /* open').diagnostics).toMatchObject([{ offset: 11 }]);
  });

  it('tokenizes comments, white space and line breaks', () => {
    const text = "{\r\n  // c\r\n  a: /* b */ 'x', \u00A0\n}";
    expectTokensCoverText(text);
    const kinds = parseJson5(text).tokens.map((t) => text.slice(t.offset, t.end));
    expect(kinds).toEqual([
      '{',
      '\r\n',
      '  ',
      '// c',
      '\r\n',
      '  ',
      'a',
      ':',
      ' ',
      '/* b */',
      ' ',
      "'x'",
      ',',
      ' \u00A0',
      '\n',
      '}',
    ]);
  });
});

describe('detectStyle for JSON5', () => {
  it('reads the majority quote of string values and the key style', () => {
    expect(detectStyle("{a: 'x', b: 'y', 'c': \"z\"}", 'json5')).toMatchObject({
      quote: "'",
      unquotedKeys: true,
    });
    expect(detectStyle('{"a": "x", b: \'y\'}', 'json5')).toMatchObject({
      quote: '"',
      unquotedKeys: false,
    });
  });

  it('falls back to the keys’ quote when there are no string values, then to double quotes', () => {
    expect(detectStyle("{'a': 1}", 'json5').quote).toBe("'");
    expect(detectStyle('[1, 2]', 'json5').quote).toBe('"');
  });

  it('does not read comment or string contents as syntax', () => {
    expect(detectStyle("{a: '// x,]', b: 1,}", 'json5').trailingCommas).toBe(true);
    expect(detectStyle("{a: '[1,]'}", 'json5').trailingCommas).toBe(false);
  });
});

describe('applyPatch', () => {
  const apply = (text: string, ...patch: Parameters<typeof json5Adapter.applyPatch>[1]) =>
    json5Adapter.applyPatch(text, patch);

  it("quotes a new key when most of its object's keys are quoted, or it is not an identifier", () => {
    expect(apply("{'a': 1, b: 2, 'c': 3}", { op: 'add', path: '/d', value: 4 })).toBe(
      "{'a': 1, b: 2, 'c': 3, 'd': 4}",
    );
    expect(apply("{a: 'x'}", { op: 'add', path: '/b-c', value: 1 })).toBe("{a: 'x', 'b-c': 1}");
    expect(apply("{a: 'x', o: {}}", { op: 'add', path: '/o/k', value: 1 })).toBe(
      "{a: 'x', o: {k: 1}}",
    );
  });

  it("writes strings in the file's quote, escaping it", () => {
    expect(apply("['a']", { op: 'add', path: '/-', value: "it's" })).toBe("['a', 'it\\'s']");
  });

  it('writes a new container in the file style, with no trailing comma', () => {
    expect(
      apply("{\n  a: 'x',\n}\n", { op: 'add', path: '/b', value: { c: [1], 'd e': 'y' } }),
    ).toBe("{\n  a: 'x',\n  b: {\n    c: [\n      1\n    ],\n    'd e': 'y'\n  },\n}\n");
    expect(apply('{a: 1}', { op: 'replace', path: '/a', value: { b: 'c' } })).toBe('{a: {b:"c"}}');
  });

  it('keeps JSON5 literals outside the edit', () => {
    expect(apply('[0xFF, Infinity, +1, .5]', { op: 'replace', path: '/1', value: 2 })).toBe(
      '[0xFF, 2, +1, .5]',
    );
  });

  it('removes a member on lines ended by U+2028', () => {
    expect(apply('[\u2028  1,\u2028  2,\u2028]', { op: 'remove', path: '/0' })).toBe(
      '[\u2028  2,\u2028]',
    );
  });

  it('matches a \\u-escaped key by its decoded name', () => {
    expect(apply('{\\u0061: 1, b: 2}', { op: 'remove', path: '/a' })).toBe('{b: 2}');
  });

  it('throws a PatchError on text that does not parse', () => {
    expect(() => apply("{a: 'x", { op: 'add', path: '/b', value: 1 })).toThrow(PatchError);
  });

  it('writes the whole document into an empty text (R15, UNK-026)', () => {
    expect(apply('', { op: 'add', path: '', value: 1 })).toBe('1\n');
    expect(() => apply('', { op: 'add', path: '/a', value: 1 })).toThrow(PatchError);
  });

  it('throws a PatchError for a value JSON5 cannot hold', () => {
    expect(() => apply('[]', { op: 'add', path: '/-', value: undefined })).toThrow(PatchError);
  });
});

describe('data agrees with the json5 package', () => {
  it(`on stringify output: 2 000 runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(dataArbitrary('json5'), styleArbitrary, (value, style) => {
        const text = stringify(value, 'json5', style);
        // The json5 package reads a big number (spec 015) as its nearest number.
        const data = nearestNumbers(json5Adapter.parse(text).data);
        expect(isDeepStrictEqual(data, JSON5.parse(text))).toBe(true);
        expectTokensCoverText(text);
      }),
      { seed: SEED, numRuns: 2_000 },
    );
  });
});
