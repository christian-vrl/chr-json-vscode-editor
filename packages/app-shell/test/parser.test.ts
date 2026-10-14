// The library's `parser` prop backed by core (003 T5, criterion 10), with big numbers read as core
// reads them and written as their digits (spec 015 B4, 015 T4).
import {
  cachedParseTexts,
  getAdapter,
  holdsBigNumber,
  LosslessNumber,
  nearestNumbers,
  releaseParse,
} from '@chr-json-editor/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EditorNumber, editorNumbers } from '../src/editor-numbers.js';
import { badLinesOf, parserFor, validationParserFor } from '../src/parser.js';

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
      // Big numbers as core reads them (spec 015 B1), as the editor's own class.
      expect(data, format).toStrictEqual(editorNumbers(getAdapter(format).parse(text).data));
      if (text.includes('__proto__')) {
        expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
        expect(Object.keys(data as object)).toContain('__proto__');
      }
    }
  });

  it.each([
    // lossless-json's parser takes these; the ones it would read differently go to core.
    '{"__proto__": {"x": 12345678901234567890}, "a": 1}',
    '{"\\u005f_proto__": [1e400], "a": 1}',
    '{"a": 12345678901234567890, "a": 2, "b": 3}',
    '{"a": 12345678901234567890, "a": 12345678901234567891}',
    '[12345678901234567890, -0, 1e2, 4.0, 0.1, "12345678901234567890", "1e400"]',
    '  [1e400]  ',
    '12345678901234567890',
    '{"isLosslessNumber": true, "value": "12345678901234567890"}',
  ])('reads strict JSON with big numbers as core does: %s', (text) => {
    for (const format of ['json', 'jsonc', 'json5'] as const) {
      const data = parserFor(format).parse(text);
      expect(data, format).toStrictEqual(editorNumbers(getAdapter(format).parse(text).data));
      if (text.includes('proto')) {
        expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
        expect(Object.keys(data as object)).toContain('__proto__');
      }
    }
  });

  it.each([
    '[12345678901234567890,]',
    '[012345678901234567890]',
    '{"a": 12345678901234567890',
    '[1e400] x',
    '"12345678901234567890\n"',
  ])('reports text that is not strict JSON as core does: %j', (text) => {
    const result = getAdapter('json').parse(text);
    const error = result.diagnostics.find((d) => d.severity === 'error');
    if (error) expect(() => parserFor('json').parse(text)).toThrow(SyntaxError);
    else expect(parserFor('json').parse(text)).toStrictEqual(editorNumbers(result.data));
  });

  // Spec 015 B4: the page's big numbers are EditorNumbers, whose valueOf never throws.
  it('reads big numbers in every format as EditorNumbers, plain numbers as numbers', () => {
    const texts = {
      json: '{"a": 12345678901234567890, "b": [1e400, 1E-400, 4.0, -0], "c": "1e400"}',
      jsonc: '{"a": 12345678901234567890, /* c */ "b": [1e400, 1E-400, 4.0, -0], "c": "1e400",}',
      json5: "{a: 0xAB54A98CEB1F0AD2, b: [1e400, 1E-400, 4.0, -0], c: '1e400'}",
    };
    for (const [format, text] of Object.entries(texts)) {
      const data = parserFor(format as keyof typeof texts).parse(text) as {
        a: EditorNumber;
        b: unknown[];
      };
      expect(data.a, format).toBeInstanceOf(EditorNumber);
      expect(data.a.value, format).toBe('12345678901234567890');
      expect(data.b[0], format).toBeInstanceOf(EditorNumber);
      expect(data.b.slice(2), format).toStrictEqual([4, -0]);
      expect(Number(data.b[0]), format).toBe(Infinity);
      expect(Number(data.b[1]), format).toBe(0);
      expect(data.a.valueOf(), format).toBe(12345678901234567890n);
    }
    // lossless-json's own valueOf throws for these; the library's sorts call it.
    expect(() => new LosslessNumber('1e400').valueOf()).toThrow(/overflow/);
    expect(() => `${String(new EditorNumber('1e400'))}${+new EditorNumber('1e400')}`).not.toThrow();
  });

  it('reads JSON Lines big numbers as EditorNumbers', () => {
    expect(parserFor('jsonl').parse('{"id": 12345678901234567890}\n[1e400, 7]\n')).toStrictEqual([
      { id: new EditorNumber('12345678901234567890') },
      [new EditorNumber('1e400'), 7],
    ]);
  });

  it('stringifies big numbers as their digits, and a look-alike object as an object', () => {
    const parser = parserFor('json');
    const data = parser.parse(
      '{"a": 12345678901234567890, "b": [1e400, -0], "c": {"isLosslessNumber": true, "value": "1"}}',
    );
    expect(parser.stringify(data)).toBe(
      '{"a":12345678901234567890,"b":[1e400,0],"c":{"isLosslessNumber":true,"value":"1"}}',
    );
    expect(parser.stringify(data, null, 2)).toBe(
      '{\n  "a": 12345678901234567890,\n  "b": [\n    1e400,\n    0\n  ],\n  "c": {\n' +
        '    "isLosslessNumber": true,\n    "value": "1"\n  }\n}',
    );
    expect(parser.stringify(new EditorNumber('0.1000000000000000000001'))).toBe(
      '0.1000000000000000000001',
    );
    // What the library does with typed text (stringConvert): a value with more digits than a float.
    expect(parser.parse('98765432109876543210')).toStrictEqual(
      new EditorNumber('98765432109876543210'),
    );
  });

  // Spec 015 B6: the validator's data holds nearest numbers (015 T1 REPORT §4, finding 5).
  it('hands the validator nearest numbers', () => {
    for (const format of ['json', 'jsonc', 'json5'] as const) {
      const text = '{"a": 12345678901234567890, "b": [1e400, 0.1000000000000000000001]}';
      const parser = validationParserFor(format);
      expect(parser.parse(text), format).toStrictEqual({
        a: 12345678901234567000,
        b: [Infinity, 0.1],
      });
      expect(parser).not.toBe(parserFor(format));
      expect(validationParserFor(format)).toBe(parser);
      // What the library does: the editor's data written by `parser`, read by `validationParser`.
      const data = parserFor(format).parse(text);
      expect(parser.parse(parserFor(format).stringify(data)!)).toStrictEqual(nearestNumbers(data));
    }
    expect(validationParserFor('json', true)).toBe(parserFor('json', true));
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

  // Spec 015 criterion 12 (UNK-068 ★, 015 T6): a large-file tab shows big numbers' digits.
  it.each([
    ['json', '{"a": 12345678901234567890, "b": [1e400, 0.1000000000000000000001], "c": 5}'],
    ['json', '{"__proto__": 12345678901234567890, "a": 1, "a": 1e400}'],
    ['jsonc', '{"a": 12345678901234567890, /* c */ "b": [1e400, 0.1000000000000000000001],}'],
    [
      'json5',
      '{a: 12345678901234567890, b: [1e400, 0.1000000000000000000001], h: 0xAB54A98CEB1F0AD2,}',
    ],
    ['jsonl', '{"a": 12345678901234567890}\n[1e400, 0.1000000000000000000001]\n5\n'],
  ] as const)('reads big numbers in %s exactly, as EditorNumbers: %j', (format, text) => {
    const data = parserFor(format, true).parse(text);
    expect(data).toStrictEqual(parserFor(format).parse(text));
    expect(holdsBigNumber(data)).toBe(true);
    expect(holdsBigNumber(nearestNumbers(data))).toBe(false);
    const numbers: unknown[] = [];
    JSON.stringify(data, (_key, value: unknown) => {
      if (value instanceof LosslessNumber) numbers.push(value);
      return value instanceof LosslessNumber ? null : value;
    });
    expect(numbers.length).toBeGreaterThan(0);
    for (const number of numbers) expect(number).toBeInstanceOf(EditorNumber);
    // The validator's data is the parser's own (the host validates; the library never reads it twice).
    expect(validationParserFor(format, true)).toBe(parserFor(format, true));
  });

  it('keeps plain data as parseData gives it, with no big-number candidate', () => {
    const text = '{"a": [1, 2.5, -0, 1e2], "b": "12345678901234567890"}';
    for (const format of ['json', 'jsonc', 'json5', 'jsonl'] as const)
      expect(parserFor(format, true).parse(text)).toStrictEqual(parserFor(format).parse(text));
  });

  it('is its own object per format, kept until asked for another', () => {
    expect(parserFor('jsonc', true)).toBe(parserFor('jsonc', true));
    expect(parserFor('jsonc', true)).not.toBe(parserFor('jsonc'));
  });
});

// JSON Lines (spec 012, 012 T4): the items as an array, never the `JSON.parse` reading of the text.
describe("parserFor('jsonl')", () => {
  it.each([
    // A one-line file is valid JSON whose data is the item (plan 012 risk R2).
    ['{"a":1}', [{ a: 1 }]],
    ['{"a":1}\n', [{ a: 1 }]],
    ['[1,2]\r\n\r\n"x"', [[1, 2], 'x']],
    ['42', [42]],
    ['', []],
    ['  \n\t\n', []],
  ])('reads %j as its items', (text, data) => {
    expect(parserFor('jsonl').parse(text)).toEqual(data);
  });

  it('reads a text with bad lines as the items of the other lines (L1), without throwing', () => {
    expect(parserFor('jsonl').parse('{"a":1}\n{"b":\n2\n{c}\n')).toEqual([{ a: 1 }, 2]);
  });

  // 012 T6 (spec 012 criterion 10): a large-file tab reads the same items with core's data-only
  // `readLines`, bad lines included, and names the same bad lines.
  it.each([
    ['{"a":1}', [{ a: 1 }], []],
    ['{"a":1}\n{"b":\n2\n{c}\n', [{ a: 1 }, 2], [2, 4]],
    ['\uFEFF1\r\n\r\n1 2\r\n[3]', [1, [3]], [3]],
    ['', [], []],
  ])('reads %j in a large-file tab as the normal tab does', (text, data, bad) => {
    expect(parserFor('jsonl', true)).not.toBe(parserFor('jsonl'));
    expect(parserFor('jsonl', true).parse(text)).toEqual(data);
    expect(parserFor('jsonl').parse(text)).toEqual(data);
    expect(badLinesOf(text, true)).toEqual(bad);
    expect(badLinesOf(text, false)).toEqual(bad);
    // The second read of the same text (the parser after `badLinesOf`) gives the items again.
    expect(parserFor('jsonl', true).parse(text)).toEqual(data);
  });

  it('keeps no full parse of a large-file text in core', () => {
    const text = '{"large":1}\n{"bad"\n';
    releaseParse();
    expect(badLinesOf(text, true)).toEqual([2]);
    expect(parserFor('jsonl', true).parse(text)).toEqual([{ large: 1 }]);
    expect(cachedParseTexts()).not.toContain(text);
  });
});

// Strict JSON with a big number goes through lossless-json's parser (core `readJsonExact`), not
// core's: for documents of big and plain numbers, strings that look like numbers, duplicate keys
// and odd whitespace, the data is core's, big numbers as EditorNumbers.
describe('parserFor: strict JSON with big numbers (spec 015 B4, property)', () => {
  const token = fc.oneof(
    fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }).map(String),
    fc
      .tuple(fc.bigInt({ min: 1n, max: 10n ** 25n }), fc.integer({ min: 0, max: 30 }))
      .map(([digits, scale]) => {
        const text = String(digits).padStart(scale + 1, '0');
        return scale === 0 ? text : `${text.slice(0, -scale)}.${text.slice(-scale)}`;
      }),
    fc
      .tuple(fc.integer({ min: 1, max: 99999 }), fc.integer({ min: -1000, max: 1000 }))
      .map(([m, e]) => `${m}e${e}`),
    fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => JSON.stringify(n)),
    fc.constantFrom('-0', '4.0', '1E400', '9007199254740993', '0.1000000000000000000001'),
  );
  const space = fc.constantFrom('', ' ', '\n', '\t', '\r\n  ');
  const key = fc.constantFrom('a', 'b', 'id', '12345678901234567890', 'isLosslessNumber', 'value');
  const { value } = fc.letrec<{ value: string }>((tie) => ({
    value: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      token,
      token.map((t) => JSON.stringify(t)),
      fc.constantFrom('null', 'true', 'false'),
      fc
        .array(fc.tuple(space, tie('value')), { maxLength: 5 })
        .map((items) => `[${items.map(([w, v]) => w + v).join(',')}]`),
      fc
        .array(fc.tuple(key, space, tie('value')), { maxLength: 5 })
        .map((members) => `{${members.map(([k, w, v]) => `${w}"${k}":${v}`).join(',')}}`),
    ),
  }));

  it('equals core', () => {
    fc.assert(
      fc.property(value, space, (text, w) => {
        const document = w + text + w;
        const expected = editorNumbers(getAdapter('json').parse(document).data);
        expect(parserFor('json').parse(document)).toStrictEqual(expected);
      }),
      { seed: 15004, numRuns: 2000 },
    );
  });
});
