// 015 T2 gate, spec 015 criterion 2: for 10 000 documents per format (seed committed in
// `arbitraries.ts`) whose numbers come from a big-number generator (integers of 16–40 digits,
// decimals of 16–40 significant digits, exponents up to ±1000, mixed with plain numbers),
// `parse(text).data`, the tree's number nodes and `parseData(format, text)` hold a `LosslessNumber`
// exactly where the text has a big number, with `value` equal to its decimal text, and today's
// number elsewhere; `parse(stringify(x, format, style)).data` equals `x` (spec 002 criterion 6 with
// big numbers, read as `read-back.ts` says); and spec 008 criterion 6 still holds on these texts.
//
// The expected data is built from each token independently of core: whether it is big is
// lossless-json's `isSafeNumber` on its decimal text (spec 015 §Terms), and "today's number" is
// `JSON.parse` of the token, or the json5 package's reading of a JSON5 token.
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import JSON5 from 'json5';
import { isSafeNumber } from 'lossless-json';
import { describe, expect, it } from 'vitest';
import {
  getAdapter,
  LosslessNumber,
  parseData,
  stringify,
  type Format,
  type FormatNode,
} from '../src/index.js';
import { SEED, styleArbitrary } from './arbitraries.js';
import { expectAgrees } from './parse-data-agrees.js';
import { readBack } from './read-back.js';

const RUNS = 10_000;
const formats = ['json', 'jsonc', 'json5', 'jsonl'] as const;

/** A number as written, and its data. */
interface Leaf {
  token: string;
  data: number | LosslessNumber;
}

const digits = (min: number, max: number) =>
  fc.string({ unit: fc.constantFrom(...'0123456789'), minLength: min, maxLength: max });
const nonZero = fc.constantFrom(...'123456789');
const sign = fc.constantFrom('', '', '-');

/** RFC 8259 number texts, about half of them big. */
const decimalToken = fc.oneof(
  // Integers of 16–40 digits.
  fc.tuple(sign, nonZero, digits(15, 39)).map(([s, d, rest]) => `${s}${d}${rest}`),
  // Decimals of 16–40 significant digits, some with leading zeros after the dot.
  fc
    .tuple(sign, nonZero, digits(15, 39), fc.integer({ min: 0, max: 40 }), fc.boolean())
    .map(([s, d, rest, at, small]) => {
      const significant = d + rest;
      if (small) return `${s}0.${'0'.repeat(at % 5)}${significant}`;
      const dot = 1 + (at % (significant.length - 1));
      return `${s}${significant.slice(0, dot)}.${significant.slice(dot)}`;
    }),
  // Exponents up to ±1000 on short and long mantissas.
  fc
    .tuple(
      sign,
      nonZero,
      digits(0, 20),
      fc.boolean(),
      fc.constantFrom('e', 'E'),
      fc.constantFrom('', '+', '-'),
      fc.integer({ min: 0, max: 1000 }),
    )
    .map(([s, d, rest, dot, e, es, exponent]) => {
      const mantissa = dot && rest.length > 0 ? `${d}.${rest}` : `${d}${rest}`;
      return `${s}${mantissa}${e}${es}${exponent}`;
    }),
  // Plain numbers, as JSON.stringify writes them, and the edges around 2^53.
  fc.integer().map(String),
  fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => JSON.stringify(n)),
  fc.constantFrom(
    '0',
    '-0',
    '4.0',
    '1e2',
    '9007199254740991',
    '-9007199254740991',
    '9007199254740992',
    '9007199254740993',
    '0.1',
    '1.0000000000000002',
    '1.5e300',
  ),
);

/** A big number's decimal text when it is one; otherwise undefined. */
const bigText = (decimal: string): string | undefined =>
  isSafeNumber(decimal) ? undefined : decimal;

const jsonLeaf = decimalToken.map((token): Leaf => {
  const decimal = bigText(token);
  return { token, data: decimal ? new LosslessNumber(decimal) : (JSON.parse(token) as number) };
});

/** JSON5 forms of a decimal token: a `+` sign, hex for integers, `.5` and `5.` (spec 015 §Terms,
 *  decimal text). The decimal text is the token it came from, written the RFC 8259 way. */
const json5Leaf = fc
  .tuple(decimalToken, fc.constantFrom('as is', 'plus', 'hex', 'dot', 'dot'))
  .map(([decimal, form]): Leaf => {
    const negative = decimal.startsWith('-');
    const unsigned = negative ? decimal.slice(1) : decimal;
    let token = decimal;
    const text = decimal;
    if (form === 'plus' && !negative) token = `+${decimal}`;
    else if (form === 'hex' && /^[1-9]\d*$/.test(unsigned)) {
      token = `${negative ? '-' : ''}0x${BigInt(unsigned).toString(16).toUpperCase()}`;
    } else if (form === 'dot' && unsigned.startsWith('0.')) {
      token = `${negative ? '-' : ''}${unsigned.slice(1)}`;
    } else if (form === 'dot' && /^\d+$/.test(unsigned)) {
      token = `${decimal}.`;
    } else if (form === 'dot' && /^\d+e/i.test(unsigned)) {
      token = decimal.replace(/[eE]/, '.$&');
    }
    const big = bigText(text);
    return { token, data: big ? new LosslessNumber(big) : JSON5.parse<number>(token) };
  });

/** A document's shape: leaves, arrays and objects. */
type Shape = Leaf | Shape[] | { entries: [string, Shape][] };

const key = fc.constantFrom('id', 'a', 'b', 'value', 'isLosslessNumber', '__proto__', 'n 1');

function shapeArbitrary(leaf: fc.Arbitrary<Leaf>): fc.Arbitrary<Shape> {
  const { shape } = fc.letrec<{ shape: Shape }>((tie) => ({
    shape: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      leaf,
      fc.array(tie('shape'), { maxLength: 6 }),
      fc
        .uniqueArray(fc.tuple(key, tie('shape')), { maxLength: 5, selector: ([k]) => k })
        .map((entries) => ({ entries })),
    ),
  }));
  return shape;
}

const isLeaf = (s: Shape): s is Leaf => 'token' in s;

/** The data of a shape, `__proto__` members as members. */
function dataOf(shape: Shape): unknown {
  if (isLeaf(shape)) return shape.data;
  if (Array.isArray(shape)) return shape.map(dataOf);
  const object: Record<string, unknown> = {};
  for (const [k, v] of shape.entries)
    Object.defineProperty(object, k, {
      value: dataOf(v),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  return object;
}

/** The leaves in document order. */
function leavesOf(shape: Shape): Leaf[] {
  if (isLeaf(shape)) return [shape];
  if (Array.isArray(shape)) return shape.flatMap(leavesOf);
  return shape.entries.flatMap(([, v]) => leavesOf(v));
}

const SEPARATORS = [', ', ',\n  ', ','];

/** The shape as text in `format`, its layout and comments drawn from `g`. JSON Lines items stay on
 *  one line each. */
function print(shape: Shape, format: Format, g: fc.GeneratorValue, oneLine = false): string {
  const comment = () =>
    (format === 'jsonc' || format === 'json5') && g(fc.integer, { min: 1, max: 6 }) === 1
      ? ' /* c */ '
      : '';
  const sep = oneLine ? ', ' : SEPARATORS[g(fc.integer, { min: 0, max: SEPARATORS.length - 1 })]!;
  if (isLeaf(shape)) return shape.token;
  if (Array.isArray(shape))
    return `[${comment()}${shape.map((s) => print(s, format, g, oneLine) + comment()).join(sep)}]`;
  const name = (k: string) =>
    format === 'json5' && /^[a-z]\w*$/i.test(k) && g(fc.boolean) ? k : JSON.stringify(k);
  const members = shape.entries.map(
    ([k, v]) => `${comment()}${name(k)}: ${comment()}${print(v, format, g, oneLine)}`,
  );
  return `{${members.join(sep)}${members.length && format === 'json5' && g(fc.boolean) ? ',' : ''}}`;
}

/** The number nodes' values, in document order. */
function numberNodes(node: FormatNode | undefined): unknown[] {
  if (!node) return [];
  if (node.type === 'number') return [node.value];
  return (node.children ?? []).flatMap(numberNodes);
}

function expectSame(actual: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) expect(actual, label).toEqual(expected);
  expect(isDeepStrictEqual(actual, expected), label).toBe(true);
}

describe('criterion 2: big numbers read and written exactly', () => {
  for (const format of formats) {
    it(`${format}: ${RUNS} documents, seed ${SEED}`, () => {
      const leaf = format === 'json5' ? json5Leaf : jsonLeaf;
      const document =
        format === 'jsonl'
          ? fc.array(shapeArbitrary(leaf), { minLength: 1, maxLength: 4 })
          : shapeArbitrary(leaf);
      fc.assert(
        fc.property(document, styleArbitrary, fc.gen(), (shape, style, g) => {
          const text =
            format === 'jsonl'
              ? (shape as Shape[]).map((item) => `${print(item, 'json', g, true)}\n`).join('')
              : print(shape, format, g);
          const data = dataOf(shape);
          const label = `${format}: ${text}`;

          const parsed = getAdapter(format).parse(text);
          expect(
            parsed.diagnostics.filter((d) => d.severity === 'error'),
            label,
          ).toEqual([]);
          expectSame(parsed.data, data, label);
          expectSame(
            numberNodes(parsed.tree),
            leavesOf(format === 'jsonl' ? (shape as Shape[]) : shape).map((l) => l.data),
            label,
          );
          expectSame(parseData(format, text), { data }, label);
          // Spec 008 criterion 6 on the same text, and on one with a digit taken out.
          expectAgrees(format, text);
          const at = text.search(/\d{16}/);
          if (at >= 0) expectAgrees(format, text.slice(0, at + 8) + text.slice(at + 9));

          // Spec 002 criterion 6 with big numbers; JSON and JSONC hold no non-finite number.
          const written = stringify(data, format, style);
          expectSame(
            getAdapter(format).parse(written).data,
            readBack(data),
            `${label} → ${written}`,
          );
        }),
        { seed: SEED, numRuns: RUNS },
      );
    }, 300_000);
  }
});
