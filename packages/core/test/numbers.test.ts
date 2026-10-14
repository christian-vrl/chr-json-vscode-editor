// 015 T2: big numbers read as lossless-json `LosslessNumber`s (spec 015 B1) and written as their
// digits (B2), in every adapter, `parseData`, `stringify` and the edit layer's writers. The property
// suite of criterion 2 is `big-numbers.property.test.ts`; the golden cases of criterion 1 are under
// tests/golden.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  json5DecimalText,
  jsonText,
  mayHoldBigNumber,
  numberValue,
  writeJson,
} from '../src/formats/numbers.js';
import {
  diff,
  getAdapter,
  jsonToCsv,
  LosslessNumber,
  nearestNumbers,
  parseData,
  stringify,
  type Format,
  type Style,
} from '../src/index.js';
import { SEED } from './arbitraries.js';

const big = (value: string) => new LosslessNumber(value);

describe('spec 015 §Terms: what a big number is', () => {
  it.each([
    '12345678901234567890',
    '9007199254740993',
    '9007199254740992',
    '-9007199254740993',
    '0.1000000000000000000001',
    '123456789.123456789',
    '1e400',
    '1E-400',
    '-1e400',
  ])('%s is big: a LosslessNumber holding its text', (text) => {
    expect(numberValue(text, Number(text))).toStrictEqual(big(text));
  });

  it.each([
    '9007199254740991',
    '-9007199254740991',
    '4.0',
    '1e2',
    '-0',
    '0.1',
    '1.5e300',
    '1.0000000000000002',
    '1.0000000000000000',
    '0.000000000000000000001',
  ])('%s is not big: the number the parser read', (text) => {
    expect(numberValue(text, Number(text))).toBe(Number(text));
  });

  it('keeps the parser value for text that is not an RFC 8259 number', () => {
    expect(numberValue('01234567890123456789', 7)).toBe(7);
    expect(numberValue('1.', 1)).toBe(1);
  });

  it.each([
    ['+12345678901234567890', '12345678901234567890'],
    ['-0x20000000000000', '-9007199254740992'],
    ['0XFFFFFFFFFFFFFFFFFF', '4722366482869645213695'],
    ['+0x1f', '31'],
    ['.5', '0.5'],
    ['-.5e400', '-0.5e400'],
    ['5.', '5'],
    ['5.e400', '5e400'],
    ['+.1000000000000000000001', '0.1000000000000000000001'],
    ['12345678901234567890', '12345678901234567890'],
  ])('JSON5 %s has the decimal text %s', (token, decimal) => {
    expect(json5DecimalText(token)).toBe(decimal);
  });

  it('JSON5 Infinity and NaN are not big numbers', () => {
    for (const token of ['Infinity', '-Infinity', '+Infinity', 'NaN', '-NaN'])
      expect(json5DecimalText(token)).toBeUndefined();
  });
});

describe('mayHoldBigNumber: the scan that keeps JSON.parse for texts with no big number', () => {
  const digits = (min: number, max: number) =>
    fc.string({ unit: fc.constantFrom(...'0123456789'), minLength: min, maxLength: max });
  /** RFC 8259 number texts that are big: 16+ digits with or without a dot, or a big exponent. */
  const bigText = fc
    .oneof(
      fc
        .tuple(fc.constantFrom('', '-'), fc.integer({ min: 1, max: 9 }), digits(15, 40))
        .map(([s, d, rest]) => `${s}${d}${rest}`),
      fc
        .tuple(digits(1, 20), digits(1, 40))
        .filter(([a, b]) => (a + b).replace(/^0+/, '').length >= 16)
        .map(([a, b]) => `${a.replace(/^0+(?=\d)/, '')}.${b}`),
      fc
        .tuple(
          digits(1, 15),
          fc.constantFrom('e', 'E', 'e+', 'e-', 'E-'),
          fc.integer({ min: 309, max: 1000 }),
        )
        .map(([m, e, x]) => `${m.replace(/^0+(?=\d)/, '')}${e}${x}`),
    )
    .filter((t) => numberValue(t, Number(t)) instanceof LosslessNumber);

  it('finds every big number, wherever it sits in a text', () => {
    fc.assert(
      fc.property(bigText, fc.string(), fc.string(), (token, before, after) => {
        expect(mayHoldBigNumber(`${before} ${token} ${after}`)).toBe(true);
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it('passes texts whose numbers are all short', () => {
    expect(mayHoldBigNumber('[1, 2.5, -3e10, 1234567, 123456789012345, 0.1, "charlie-123"]')).toBe(
      false,
    );
    expect(mayHoldBigNumber(`{"note": "${'.'.repeat(100)}", "zip": "12345"}`)).toBe(false);
    // A false positive (in a string) only costs the exact path.
    expect(mayHoldBigNumber('"id 1234567890123456"')).toBe(true);
  });
});

describe('writeJson: JSON.stringify with big numbers', () => {
  const json = fc.jsonValue();
  const odd = fc.oneof(
    fc.constant(undefined),
    fc.constant(() => 1),
    fc.constant(Symbol('s')),
    fc.constant(new Date(0)),
    fc.constant(Object.assign(Object.create(null) as object, { a: 1 })),
    fc.constant([1, undefined, () => 2]),
    fc.constant({ a: undefined, b: () => 1, c: Symbol('c'), d: 1 }),
    fc.constant({ toJSON: (key: string) => `key ${key}` }),
    fc.constant([new Number(1), new String('s'), new Boolean(false)]),
    fc.constant([NaN, Infinity, -0, 1e21]),
    fc.constant(JSON.parse('{"__proto__": [1]}') as unknown),
  );
  const value = fc.oneof(json, odd, fc.array(fc.oneof(json, odd)), fc.dictionary(fc.string(), odd));

  it('writes data with no big number exactly as JSON.stringify does', () => {
    fc.assert(
      fc.property(value, fc.constantFrom(undefined, '', '\t', '  ', '    '), (v, unit) => {
        expect(writeJson(v, unit)).toBe(JSON.stringify(v, null, unit));
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it('writes LosslessNumbers and BigInts as their digits', () => {
    const data = { a: big('12345678901234567890'), b: [big('1e400'), 1n, -0], c: {} };
    expect(jsonText(data)).toBe('{"a":12345678901234567890,"b":[1e400,1,0],"c":{}}');
    expect(jsonText(data, '  ')).toBe(
      '{\n  "a": 12345678901234567890,\n  "b": [\n    1e400,\n    1,\n    0\n  ],\n  "c": {}\n}',
    );
    expect(jsonText(big('-0.1000000000000000000001'))).toBe('-0.1000000000000000000001');
  });

  it('writes an object that only looks like a LosslessNumber as an object (B5)', () => {
    const lookalike = { isLosslessNumber: true, value: '1' };
    expect(jsonText([lookalike, 5n])).toBe('[{"isLosslessNumber":true,"value":"1"},5]');
  });
});

const style = (overrides: Partial<Style> = {}): Style => ({
  indent: 2,
  eol: '\n',
  finalNewline: true,
  quote: '"',
  unquotedKeys: false,
  trailingCommas: false,
  ...overrides,
});

describe('B1: every adapter and parseData read big numbers exactly', () => {
  const expected = {
    a: big('12345678901234567890'),
    b: [big('0.1000000000000000000001'), big('1e400'), big('-1E-400'), 4, -0, 0.1],
    c: 9007199254740991,
  };
  const texts: Record<Exclude<Format, 'jsonl'>, string> = {
    json: '{"a": 12345678901234567890, "b": [0.1000000000000000000001, 1e400, -1E-400, 4.0, -0, 0.1], "c": 9007199254740991}',
    jsonc:
      '{\n  // big\n  "a": 12345678901234567890,\n  "b": [0.1000000000000000000001, 1e400, -1E-400, 4.0, -0, 0.1,],\n  "c": 9007199254740991,\n}',
    json5:
      "{a: +12345678901234567890, 'b': [+.1000000000000000000001, 1e400, -1E-400, 4., -0, .1], c: 0x1FFFFFFFFFFFFF}",
  };
  for (const [format, text] of Object.entries(texts) as [Format, string][]) {
    it(`${format}: parse data, tree values and parseData`, () => {
      const parsed = getAdapter(format).parse(text);
      expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(parsed.data).toStrictEqual(expected);
      const values: unknown[] = [];
      const walk = (node: { type: string; value?: unknown; children?: readonly unknown[] }) => {
        if (node.type === 'number') values.push(node.value);
        for (const child of node.children ?? []) walk(child as typeof node);
      };
      walk(parsed.tree!);
      expect(values).toStrictEqual([expected.a, ...expected.b, expected.c]);
      expect(parseData(format, text)).toStrictEqual({ data: expected });
    });
  }

  it('json5: a hex big number is its exact decimal digits; Infinity and NaN stay numbers', () => {
    const text = '[0x20000000000000, -0xFFFFFFFFFFFFFFFFFF, Infinity, -NaN, 0x1FFFFFFFFFFFFF]';
    const data = [big('9007199254740992'), big('-4722366482869645213695'), Infinity, NaN];
    expect(getAdapter('json5').parse(text).data).toStrictEqual([...data, 9007199254740991]);
    expect(parseData('json5', text)).toStrictEqual({ data: [...data, 9007199254740991] });
  });

  it('jsonl: items, nodes and parseData', () => {
    const text = '{"id": 12345678901234567890}\n[1e400, 1]\n12\n';
    const data = [{ id: big('12345678901234567890') }, [big('1e400'), 1], 12];
    const parsed = getAdapter('jsonl').parse(text);
    expect(parsed.data).toStrictEqual(data);
    const item = parsed.tree!.children![0]!.children![0]!.children![1]!;
    expect(item.value).toStrictEqual(big('12345678901234567890'));
    expect(parseData('jsonl', text)).toStrictEqual({ data });
  });

  it('an object with isLosslessNumber and value members stays an object', () => {
    const text = '{"isLosslessNumber": true, "value": "1"}';
    for (const format of ['json', 'jsonc', 'json5'] as const) {
      const { data } = getAdapter(format).parse(text);
      expect(data).not.toBeInstanceOf(LosslessNumber);
      expect(data).toStrictEqual({ isLosslessNumber: true, value: '1' });
    }
  });
});

describe('B2: every writer writes big numbers as their digits', () => {
  const value = { id: big('98765432109876543210'), x: [big('1e400'), 2n] };

  it.each([
    ['json', '{\n  "a": 1\n}\n', '{\n  "a": 98765432109876543210\n}\n'],
    ['jsonc', '{\n  "a": 1 // one\n}\n', '{\n  "a": 98765432109876543210 // one\n}\n'],
    ['json5', '{\n  a: 1,\n}\n', '{\n  a: 98765432109876543210,\n}\n'],
    ['jsonl', '{"a": 1}\n', '{"a": 98765432109876543210}\n'],
  ] as const)('%s: replace with a big number', (format, input, output) => {
    const op = {
      op: 'replace' as const,
      path: format === 'jsonl' ? '/0/a' : '/a',
      value: big('98765432109876543210'),
    };
    expect(getAdapter(format).applyPatch(input, [op])).toBe(output);
  });

  it.each([
    [
      'json',
      '{\n  "a": 1\n}\n',
      '{\n  "a": 1,\n  "b": {\n    "id": 98765432109876543210,\n    "x": [\n      1e400,\n      2\n    ]\n  }\n}\n',
    ],
    ['jsonc', '{"a": 1}', '{"a": 1, "b": {"id":98765432109876543210,"x":[1e400,2]}}'],
    [
      'json5',
      '{\n  a: 1,\n}\n',
      '{\n  a: 1,\n  b: {\n    id: 98765432109876543210,\n    x: [\n      1e400,\n      2\n    ]\n  },\n}\n',
    ],
  ] as const)('%s: add a value holding big numbers', (format, input, output) => {
    expect(getAdapter(format).applyPatch(input, [{ op: 'add', path: '/b', value }])).toBe(output);
  });

  it('jsonl: a new item and a root replace through diff', () => {
    const adapter = getAdapter('jsonl');
    expect(adapter.applyPatch('1\n', [{ op: 'add', path: '/-', value }])).toBe(
      '1\n{"id":98765432109876543210,"x":[1e400,2]}\n',
    );
    const text = '{"id": 12345678901234567890}\n{"id": 1}\n';
    const next = [{ id: big('12345678901234567891') }, { id: 1 }];
    expect(adapter.applyPatch(text, [{ op: 'replace', path: '', value: next }])).toBe(
      '{"id": 12345678901234567891}\n{"id": 1}\n',
    );
  });

  it('copy writes the source big number exactly, hex as its decimal digits', () => {
    expect(
      getAdapter('json').applyPatch('{"a": [12345678901234567890, 1e400], "b": 1}', [
        { op: 'copy', from: '/a', path: '/c' },
      ]),
    ).toBe('{"a": [12345678901234567890, 1e400], "b": 1, "c": [12345678901234567890,1e400]}');
    expect(
      getAdapter('json5').applyPatch('{a: 0xFFFFFFFFFFFFFFFFFF, b: 1}', [
        { op: 'copy', from: '/a', path: '/b' },
      ]),
    ).toBe('{a: 0xFFFFFFFFFFFFFFFFFF, b: 4722366482869645213695}');
  });

  it('R15: a big number as the whole document', () => {
    expect(
      getAdapter('jsonc').applyPatch('// empty\n', [
        { op: 'add', path: '', value: big('12345678901234567890') },
      ]),
    ).toBe('// empty\n12345678901234567890\n');
  });

  it('stringify writes big numbers in every format', () => {
    const one = style({ indent: 0, finalNewline: false });
    for (const format of ['json', 'jsonc', 'json5'] as const)
      expect(stringify(value, format, one)).toBe(
        format === 'json5'
          ? '{"id":98765432109876543210,"x":[1e400,2]}'
          : '{"id":98765432109876543210,"x":[1e400,2]}',
      );
    expect(stringify([value, big('1')], 'jsonl', style())).toBe(
      '{"id":98765432109876543210,"x":[1e400,2]}\n1\n',
    );
  });
});

describe('015 T3: diff, sort and CSV treat a big number as a number (B3, B9)', () => {
  it('diff keeps a big number as one value: equal values are equal, others replaced', () => {
    const a = { id: big('12345678901234567890'), n: 1 };
    expect(diff(a, { id: big('12345678901234567890'), n: 1 })).toEqual([]);
    expect(diff(a, { id: big('12345678901234567890.000'), n: 1 })).toEqual([]);
    expect(diff(a, { id: big('12345678901234567891'), n: 1 })).toEqual([
      { op: 'replace', path: '/id', value: big('12345678901234567891') },
    ]);
    expect(diff({ x: 1e20 }, { x: big('100000000000000000000') })).toEqual([]);
  });

  it('sort orders big numbers by exact value among plain ones', () => {
    expect(
      getAdapter('json').sort('[5, 1e400, "a", 12345678901234567891, 1, 12345678901234567890]'),
    ).toBe('[1, 5, 12345678901234567890, 12345678901234567891, 1e400, "a"]');
  });

  it('CSV export writes big numbers as their digits, in a JSON cell too', () => {
    expect(jsonToCsv([{ id: big('12345678901234567890'), x: [big('1e400')] }])).toEqual({
      text: 'id,x\r\n12345678901234567890,[1e400]\r\n',
    });
  });

  it('nearestNumbers copies only what holds a big number', () => {
    const plain = { a: [1, 2] };
    const data = { plain, b: [big('1e400'), big('12345678901234567890')] };
    const nearest = nearestNumbers(data) as typeof data;
    expect(nearest).toStrictEqual({ plain, b: [Infinity, 12345678901234567000] });
    expect(nearest.plain).toBe(plain);
    expect(data.b[0]).toBeInstanceOf(LosslessNumber);
  });
});
