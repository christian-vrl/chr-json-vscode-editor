// 017 T2 gate, spec 017 criteria 3 and 4 (fast-check, seed committed in `arbitraries.ts`, 10 000
// runs per kind).
//
// Criterion 3: for `data` from spec 002's JSON data generator, `importData(yaml.stringify(data),
// 'yaml')` has no warnings and its data equals `data` (spec 015 §Terms: numbers by exact value, `-0`
// apart from `0`, key order checked). For `data` restricted to what TOML holds, the same holds for
// `smol-toml`'s `stringify`. What TOML holds, read from TOML 1.0.0 and `smol-toml` 1.9.0: an object
// at the root, no `null` at any depth, integers within 64 bits, finite numbers, and also no `-0`
// (`stringify` writes it as the integer `0`, which TOML makes equal to `0`) and no lone surrogate
// in a string or key (TOML text is Unicode; `stringify` writes U+FFFD for one).
//
// Criterion 4: for any string, `importData` returns and never throws.
import fc from 'fast-check';
import { stringify as tomlStringify } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { stringify as yamlStringify } from 'yaml';
import { equalNumbers, importData, LosslessNumber, type ImportKind } from '../src/index.js';
import { dataArbitrary, SEED } from './arbitraries.js';

const RUNS = 10_000;

/** Equal as spec 015 §Terms says, key order included. */
export function sameData(a: unknown, b: unknown): boolean {
  const isNumber = (x: unknown) => typeof x === 'number' || x instanceof LosslessNumber;
  if (isNumber(a) && isNumber(b)) {
    if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
    if (Object.is(a, -0) || Object.is(b, -0)) return false;
    return equalNumbers(a, b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameData(item, b[i]));
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.join('\u0000') !== kb.join('\u0000') || ka.length !== kb.length) return false;
    return ka.every((k) =>
      sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return Object.is(a, b);
}

function roundTrip(text: string, kind: ImportKind, data: unknown): void {
  const result = importData(text, kind);
  if ('error' in result) throw new Error(`error ${JSON.stringify(result.error)} for ${text}`);
  expect(result.warnings).toEqual([]);
  if (!sameData(result.data, data)) expect(result.data).toEqual(data);
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** Whether TOML holds `value` below the root (see the header). */
function tomlHolds(value: unknown): boolean {
  if (value === null) return false;
  if (typeof value === 'number')
    return (
      Number.isFinite(value) &&
      !Object.is(value, -0) &&
      !(Number.isInteger(value) && Math.abs(value) >= 2 ** 63)
    );
  if (typeof value === 'string') return !LONE_SURROGATE.test(value);
  if (Array.isArray(value)) return value.every(tomlHolds);
  if (typeof value === 'object')
    return Object.keys(value).every(
      (k) => !LONE_SURROGATE.test(k) && tomlHolds((value as Record<string, unknown>)[k]),
    );
  return true;
}

const tomlData = dataArbitrary('json').filter(
  (data) => typeof data === 'object' && data !== null && !Array.isArray(data) && tomlHolds(data),
);

describe('importData: round trip (criterion 3)', () => {
  it(`yaml: ${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(dataArbitrary('json'), (data) => roundTrip(yamlStringify(data), 'yaml', data)),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it(`toml: ${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(tomlData, (data) => roundTrip(tomlStringify(data), 'toml', data)),
      { seed: SEED, numRuns: RUNS },
    );
  });

  // 017-T1 review note: `-0` and the keys `__proto__` and `constructor` (A4), beside the property.
  const edges: [string, unknown][] = [
    ['-0', { a: -0, b: [-0] }],
    ['__proto__', JSON.parse('{"__proto__": {"x": 1}, "y": {"__proto__": [1]}}')],
    ['constructor', { constructor: { prototype: 1 }, toString: 'x' }],
  ];
  it.each(edges)('yaml: %s', (_, data) => roundTrip(yamlStringify(data), 'yaml', data));
  it.each(edges.filter(([name]) => name !== '-0'))('toml: %s', (_, data) =>
    roundTrip(tomlStringify(data), 'toml', data),
  );
  it('toml: -0.0 is negative zero (TM3), the integer -0 is 0', () => {
    roundTrip('a = -0.0\nb = -0\n', 'toml', { a: -0, b: 0 });
  });
});

describe('importData: hostile input (criterion 4)', () => {
  const text = fc.oneof(
    fc.string({ unit: 'binary', maxLength: 200 }),
    fc.string({
      unit: fc.constantFrom(...'[]{}<>/!?&;:-,."\'#=\n *a1%|>!'.split('')),
      maxLength: 200,
    }),
  );
  it.each(['yaml', 'toml', 'xml'] as const)(
    `%s: never throws, ${RUNS} runs, seed ${SEED}`,
    (kind) => {
      fc.assert(
        fc.property(text, (input) => {
          const result = importData(input, kind);
          expect('data' in result || 'error' in result).toBe(true);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    },
  );
});
