// 015 T6 follow-up (UNK-089): `readJsonExact` reads through `JSON.parse`, with big numbers written
// as marked strings first. Its data must be what lossless-json's parser gave before (the reference
// below, the earlier implementation), and it must refuse exactly the texts `JSON.parse` refuses.
import fc from 'fast-check';
import { isSafeNumber, parse as losslessParse } from 'lossless-json';
import { describe, expect, it } from 'vitest';
import { readJsonExact } from '../src/formats/numbers.js';
import { LosslessNumber } from '../src/index.js';
import { SEED } from './arbitraries.js';

const big = (value: string) => new LosslessNumber(value);

/** The earlier `readJsonExact`: lossless-json's parser. */
function reference(text: string): { data: unknown } | undefined {
  const number = (token: string): unknown =>
    (token.length > 15 || token.includes('e') || token.includes('E')) && !isSafeNumber(token)
      ? big(token)
      : Number(token);
  try {
    return {
      data: losslessParse(text, null, {
        parseNumber: number,
        onDuplicateKey: ({ newValue }) => newValue,
      }),
    };
  } catch {
    return undefined;
  }
}

const isJson = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

describe('readJsonExact: big numbers exact through JSON.parse', () => {
  it.each([
    ['one big number', '12345678901234567890', big('12345678901234567890')],
    [
      'in an array',
      '[1, 12345678901234567890, 1e400]',
      [1, big('12345678901234567890'), big('1e400')],
    ],
    [
      'beside the same digits in a key and a string',
      '{"12345678901234567890": "12345678901234567890 1e400", "b": -12345678901234567890}',
      { '12345678901234567890': '12345678901234567890 1e400', b: big('-12345678901234567890') },
    ],
    [
      'after escaped quotes and backslashes',
      '["a\\"b 12345678901234567890", "c\\\\", 12345678901234567891, "\\\\\\" 1e400"]',
      ['a"b 12345678901234567890', 'c\\', big('12345678901234567891'), '\\" 1e400'],
    ],
    [
      'a duplicate key: the last value in the first place',
      '{"a": 12345678901234567890, "b": 1, "a": 2}',
      { a: 2, b: 1 },
    ],
    [
      'a string holding the mark',
      '["\\u0001x", 12345678901234567890]',
      ['\u0001x', big('12345678901234567890')],
    ],
    [
      'plain numbers stay numbers',
      '[1e5, 1.5, -0, 9007199254740991]',
      [1e5, 1.5, -0, 9007199254740991],
    ],
  ])('%s', (_, text, data) => {
    expect(readJsonExact(text)).toStrictEqual({ data });
  });

  it.each([
    ['a big number as a key', '{12345678901234567890: 1}'],
    ['a big number with a leading zero', '[012345678901234567890]'],
    ['a big number after a letter', '[x12345678901234567890]'],
    ['two values', '12345678901234567890 1'],
    ['a trailing comma', '[12345678901234567890,]'],
    ['a stray backslash', '[\\12345678901234567890]'],
    ['an unclosed string', '["12345678901234567890]'],
    // lossless-json read a leading dot; JSON does not, so the caller reads it with core.
    ['a leading-dot number beside a big one', '[.5, 12345678901234567890]'],
  ])('refuses %s', (_, text) => {
    expect(readJsonExact(text)).toBeUndefined();
  });

  it('reads deep nesting', () => {
    const depth = 20_000;
    const text = `${'['.repeat(depth)}12345678901234567890${']'.repeat(depth)}`;
    let data = readJsonExact(text)?.data;
    for (let i = 0; i < depth; i++) data = (data as unknown[])[0];
    expect(data).toStrictEqual(big('12345678901234567890'));
  });

  it('gives each big number to big', () => {
    expect(readJsonExact('{"a": [1e400]}', (decimal) => `big ${decimal}`)).toStrictEqual({
      data: { a: ['big 1e400'] },
    });
  });

  // Documents of big and plain numbers, strings that hold number-like text, quotes and backslashes,
  // the mark, duplicate keys and odd whitespace; then the same texts with one character inserted or
  // removed, most of them no longer JSON.
  const token = fc.oneof(
    fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }).map(String),
    fc
      .tuple(fc.integer({ min: 1, max: 99999 }), fc.integer({ min: -1000, max: 1000 }))
      .map(([m, e]) => `${m}e${e}`),
    fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => JSON.stringify(n)),
    fc.constantFrom('-0', '4.0', '1E400', '9007199254740993', '0.1000000000000000000001'),
  );
  const stringText = fc
    .array(
      fc.oneof(token, fc.constantFrom('\\"', '\\\\', '\\u0001', '\\n', ' ', 'a', ':', ',', '[')),
      { maxLength: 4 },
    )
    .map((parts) => `"${parts.join('')}"`);
  const space = fc.constantFrom('', ' ', '\n', '\t', '\r\n  ');
  const { value } = fc.letrec<{ value: string }>((tie) => ({
    value: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      token,
      stringText,
      fc.constantFrom('null', 'true', 'false'),
      fc
        .array(fc.tuple(space, tie('value')), { maxLength: 5 })
        .map((items) => `[${items.map(([w, v]) => w + v).join(',')}]`),
      fc
        .array(fc.tuple(fc.oneof(stringText, fc.constantFrom('"a"', '"b"')), space, tie('value')), {
          maxLength: 5,
        })
        .map((members) => `{${members.map(([k, w, v]) => `${w}${k}:${v}`).join(',')}}`),
    ),
  }));
  const document = fc.tuple(value, space).map(([text, w]) => w + text + w);
  const edited = fc
    .tuple(document, fc.nat(), fc.constantFrom('', '"', '\\', ',', ':', '1', 'x', ' ', '{', ']'))
    .map(([text, at, insert]) => {
      const i = at % (text.length + 1);
      return insert === ''
        ? text.slice(0, i) + text.slice(i + 1)
        : text.slice(0, i) + insert + text.slice(i);
    });

  it('equals lossless-json on JSON, and refuses what JSON.parse refuses (property)', () => {
    fc.assert(
      fc.property(fc.oneof(document, edited), (text) => {
        const read = readJsonExact(text);
        expect(read).toStrictEqual(isJson(text) ? reference(text) : undefined);
      }),
      { seed: SEED, numRuns: 5000 },
    );
  });
});
