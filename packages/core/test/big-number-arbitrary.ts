// The big-number generator of spec 015 criterion 2 (015 T2), shared with the tests that run it
// elsewhere (015 T5: spec 015 criterion 9, the identity query over it). Numbers are integers of 16–40
// digits, decimals of 16–40 significant digits and exponents up to ±1000, mixed with plain numbers;
// whether a token is big is lossless-json's `isSafeNumber` on its decimal text (spec 015 §Terms),
// and "today's number" is `JSON.parse` of the token, or the json5 package's reading of a JSON5 token.
import fc from 'fast-check';
import JSON5 from 'json5';
import { isSafeNumber } from 'lossless-json';
import { LosslessNumber } from '../src/index.js';

/** A number as written, and its data. */
export interface Leaf {
  token: string;
  data: number | LosslessNumber;
}

const digits = (min: number, max: number) =>
  fc.string({ unit: fc.constantFrom(...'0123456789'), minLength: min, maxLength: max });
const nonZero = fc.constantFrom(...'123456789');
const sign = fc.constantFrom('', '', '-');

/** RFC 8259 number texts, about half of them big. */
export const decimalToken = fc.oneof(
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

export const jsonLeaf = decimalToken.map((token): Leaf => {
  const decimal = bigText(token);
  return { token, data: decimal ? new LosslessNumber(decimal) : (JSON.parse(token) as number) };
});

/** JSON5 forms of a decimal token: a `+` sign, hex for integers, `.5` and `5.` (spec 015 §Terms,
 *  decimal text). The decimal text is the token it came from, written the RFC 8259 way. */
export const json5Leaf = fc
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
export type Shape = Leaf | Shape[] | { entries: [string, Shape][] };

const key = fc.constantFrom('id', 'a', 'b', 'value', 'isLosslessNumber', '__proto__', 'n 1');

export function shapeArbitrary(leaf: fc.Arbitrary<Leaf>): fc.Arbitrary<Shape> {
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

export const isLeaf = (s: Shape): s is Leaf => 'token' in s;

/** The data of a shape, `__proto__` members as members. */
export function dataOf(shape: Shape): unknown {
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
export function leavesOf(shape: Shape): Leaf[] {
  if (isLeaf(shape)) return [shape];
  if (Array.isArray(shape)) return shape.flatMap(leavesOf);
  return shape.entries.flatMap(([, v]) => leavesOf(v));
}

/** Data whose numbers come from the generator (RFC 8259 tokens), `__proto__` members as members. */
export const bigNumberData: fc.Arbitrary<unknown> = shapeArbitrary(jsonLeaf).map(dataOf);
