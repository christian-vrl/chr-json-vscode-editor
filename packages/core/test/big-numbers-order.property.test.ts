// 015 T3 gate, spec 015 criterion 3: numbers are equal and ordered by exact value (B3), mixed plain
// numbers and big numbers alike. `diff(a, b)` is empty exactly when `a` and `b` are equal per spec 015
// §Terms; `compare` reports `…890` vs `…891` as changed and `1e20` vs `100000000000000000000` as
// equal; `sort` orders criterion 3's array as it says, and for random arrays of mixed numbers (seed
// committed in `arbitraries.ts`) the order equals sorting their exact values with BigInt arithmetic
// (`tests/golden/facts.ts` `compareExact`, independent of core), equal values keeping their order.
import fc from 'fast-check';
import { isSafeNumber } from 'lossless-json';
import { describe, expect, it } from 'vitest';
import { compareExact } from '../../../tests/golden/facts.js';
import {
  compare,
  compareNumbers,
  diff,
  equalNumbers,
  getAdapter,
  LosslessNumber,
  parseData,
} from '../src/index.js';
import { SEED } from './arbitraries.js';

const RUNS = 10_000;

const data = (text: string): unknown => {
  const read = parseData('json', text);
  if ('error' in read) throw new Error(read.error.message);
  return read.data;
};
const big = (text: string) => new LosslessNumber(text);

const digits = (min: number, max: number) =>
  fc.string({ unit: fc.constantFrom(...'0123456789'), minLength: min, maxLength: max });
const sign = fc.constantFrom('', '', '-');

/** Number tokens as RFC 8259 writes them: plain ones as `JSON.stringify` writes a number, and big
 *  ones (integers of 16–40 digits, decimals of 16–40 significant digits, exponents up to ±1000). */
const plainToken = fc
  .oneof(
    fc.integer({ min: -1000, max: 1000 }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.constantFrom(9007199254740991, -9007199254740991, 1e20, 0.1, 1e21, 5e-324),
  )
  .map((n) => JSON.stringify(n));
const bigToken = fc.oneof(
  fc
    .tuple(sign, fc.constantFrom(...'123456789'), digits(15, 39))
    .map(([s, d, rest]) => `${s}${d}${rest}`),
  fc
    .tuple(sign, fc.constantFrom(...'123456789'), digits(15, 39), fc.integer({ min: 1, max: 20 }))
    .map(([s, d, rest, at]) => {
      const all = d + rest;
      const dot = Math.min(at, all.length - 1);
      return `${s}${all.slice(0, dot)}.${all.slice(dot)}`;
    }),
  fc
    .tuple(
      sign,
      fc.constantFrom(...'123456789'),
      digits(0, 19),
      fc.integer({ min: -1000, max: 1000 }),
    )
    .map(([s, d, m, e]) => `${s}${d}${m}e${e}`),
);
/** The same exact value written another way: trailing zeros after a dot, or an exponent. */
const rewrite = (token: string, how: number): string => {
  if (/[eE]/.test(token)) return token;
  if (how === 0) return token.includes('.') ? `${token}000` : `${token}.0`;
  if (how === 1 && !token.includes('.') && token !== '0') return `${token}0e-1`;
  return token;
};
const token = fc.oneof(plainToken, bigToken);
const tokens = fc
  .array(fc.tuple(token, fc.integer({ min: 0, max: 3 })), { minLength: 1, maxLength: 12 })
  .chain((pairs) =>
    // Some items repeat an earlier one's value, written the same or another way.
    fc
      .array(fc.integer({ min: 0, max: pairs.length - 1 }), { maxLength: 4 })
      .map((copies) => [
        ...pairs.map(([t]) => t),
        ...copies.map((i) => rewrite(pairs[i]![0], pairs[i]![1])),
      ]),
  );

describe('criterion 3: equality by exact value', () => {
  it('compare reports …890 vs …891 as changed and 1e20 vs 100000000000000000000 as equal', () => {
    expect(
      compare(data('{"id": 12345678901234567890}'), data('{"id": 12345678901234567891}')),
    ).toEqual([{ kind: 'changed', leftPath: '/id', rightPath: '/id' }]);
    expect(compare(data('{"x": 1e20}'), data('{"x": 100000000000000000000}'))).toEqual([]);
    expect(compare(data('[1e20, 2]'), data('[100000000000000000000, 2]'))).toEqual([]);
    expect(compare(data('{"x": 1e20}'), data('{"x": 100000000000000000001}'))).toHaveLength(1);
  });

  it('keys equal exact values alike, whatever the digits', () => {
    expect(diff([big('1e400')], [big('10e399')])).toEqual([]);
    expect(diff([big('0.1000000000000000000001')], [big('0.10000000000000000000010')])).toEqual([]);
    expect(diff([1e21], [big('1000000000000000000000')])).toEqual([]);
    expect(diff([1.1805916207174113e21], [big('1180591620717411300000')])).toEqual([]);
    // The float nearest to 1180591620717411303424 is 2^70, written 1.1805916207174113e+21: a
    // different exact value from the text, so they differ.
    expect(diff([1.1805916207174113e21], [big('1180591620717411303424')])).toHaveLength(1);
    expect(diff([big('1e400')], [Infinity])).toHaveLength(1);
    expect(diff([big('1E-400')], [0])).toHaveLength(1);
    expect(diff([0], [-0])).toHaveLength(1);
    expect(diff([NaN], [NaN])).toEqual([]);
  });

  it('equalNumbers and compareNumbers agree with BigInt arithmetic on the edges', () => {
    expect(equalNumbers(big('100000000000000000000'), 1e20)).toBe(true);
    expect(equalNumbers(big('12345678901234567890'), big('12345678901234567891'))).toBe(false);
    expect(equalNumbers(0, -0)).toBe(true);
    expect(equalNumbers(big('1e400'), Infinity)).toBe(false);
    expect(compareNumbers(Infinity, big('1e400'))).toBe(1);
    expect(compareNumbers(-Infinity, big('-1e400'))).toBe(-1);
    expect(compareNumbers(big('-0.1000000000000000000001'), -0.1)).toBe(-1);
    expect(compareNumbers(big('1E-400'), 0)).toBe(1);
    expect(compareNumbers(big('-1E-400'), -0)).toBe(-1);
  });

  it(`diff(a, b) is empty exactly when a and b are equal by exact value: ${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(tokens, fc.gen(), (left, g) => {
        // The right side: the left side with each item kept, rewritten or replaced at random.
        const right = left.map((t) => {
          const roll = g(fc.integer, { min: 0, max: 3 });
          if (roll === 0) return rewrite(t, g(fc.integer, { min: 0, max: 1 }));
          if (roll === 1) return g(() => token);
          return t;
        });
        const a = data(`[${left.join(', ')}]`);
        const b = data(`{"x": [${right.join(', ')}]}`) as { x: unknown };
        const equal = left.every((t, i) => compareExact(t, right[i]!) === 0);
        expect(diff(a, b.x).length === 0).toBe(equal);
        expect(compare(a, b.x).length === 0).toBe(equal);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  }, 60_000);
});

describe('criterion 3: order by exact value', () => {
  it("sorts criterion 3's array", () => {
    expect(
      getAdapter('json').sort(
        '[1e400, -12345678901234567890, 5, 12345678901234567891, 0.1000000000000000000001, 12345678901234567890, 0.1]',
      ),
    ).toBe(
      '[-12345678901234567890, 0.1, 0.1000000000000000000001, 5, 12345678901234567890, 12345678901234567891, 1e400]',
    );
  });

  it('sorts by a property and in descending order, equal values keeping their order', () => {
    expect(
      getAdapter('json').sort(
        '[{"id": 12345678901234567890}, {"id": 1e20}, {"id": 100000000000000000000}, {"id": 5}]',
        { property: '/id', direction: 'desc' },
      ),
    ).toBe(
      '[{"id": 1e20}, {"id": 100000000000000000000}, {"id": 12345678901234567890}, {"id": 5}]',
    );
  });

  for (const direction of ['asc', 'desc'] as const) {
    it(`${direction}: random arrays of mixed numbers sort as their exact values do: ${RUNS} runs, seed ${SEED}`, () => {
      fc.assert(
        fc.property(tokens, (items) => {
          const text = `[${items.join(', ')}]`;
          const sorted = getAdapter('json').sort(text, { direction });
          const sign = direction === 'desc' ? -1 : 1;
          // Array.prototype.sort is stable, so equal values keep their order, as in the library.
          const expected = items.slice().sort((a, b) => sign * compareExact(a, b));
          expect(sorted).toBe(`[${expected.join(', ')}]`);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    }, 60_000);
  }

  it('the token generator makes big numbers and plain ones', () => {
    const sample = fc.sample(token, { seed: SEED, numRuns: 1000 });
    expect(sample.some((t) => !isSafeNumber(t))).toBe(true);
    expect(sample.some((t) => isSafeNumber(t))).toBe(true);
  });
});
