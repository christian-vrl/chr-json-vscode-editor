// 009 T2 gate, spec 009 criterion 3 (fast-check, seed committed in `arbitraries.ts`, 10 000 runs):
// for `data` an array of objects that all have the same shape (the same keys, at least one, in the
// same order, at every level), with values that are scalars (strings, finite numbers other than
// `-0`, booleans, `null`) or non-empty objects of scalars, and for any delimiter, header on, either
// BOM setting and objects flattened or not, `csvToJson(jsonToCsv(data, o).text, { delimiter })` has
// no warnings and `data` deep-equals the input, key order included. Strings whose text is a JSON
// object or array (I7, CSV reading 9: starts with `{` or `[`, ends with `}` or `]`, and parses) are
// excluded. Keys are any strings, empty and dotted ones included.
//
// Spec 015 criterion 10 extends the scalars with big numbers (B9: exported as their digits,
// imported as the same big number, UNK-067 ★). A plain number whose written text is a big number
// (`-9007199254740992`, `100000000000000000000`) comes back as that big number, as a JSON file
// holding that text reads (B1), so the expected data holds it as one.
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { isSafeNumber } from 'lossless-json';
import { describe, expect, it } from 'vitest';
import { csvToJson, jsonToCsv, LosslessNumber, type CsvDelimiter } from '../src/index.js';
import { SEED } from './arbitraries.js';

const RUNS = 10_000;

const trickyKeys = fc.constantFrom(
  '',
  'a',
  'a.b',
  '.',
  '[0]',
  'a[0]',
  '["x"]',
  '"',
  'say "hi"',
  '__proto__',
  'constructor',
  '0',
  '7',
  'Field 0',
  ' lead',
  'trail ',
  'x,y',
  'p;q',
  'a|b',
  'tab\there',
  'line\nbreak',
  'cr\rhere',
  '﻿bom',
  'Zürich',
);
const key = fc.oneof(trickyKeys, fc.string(), fc.string({ unit: 'binary' }));

/** I7 reads a string back as that value when its text is a JSON object or array. */
function isContainerText(text: string): boolean {
  if (!/^[[{]/.test(text) || !/[\]}]$/.test(text)) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

const trickyStrings = fc.constantFrom(
  '',
  ' ',
  'null',
  'true',
  'false',
  '7',
  '-1.5',
  '1e+21',
  '007',
  '1e3',
  '-0',
  'NaN',
  'Infinity',
  ' [1]',
  '[1] ',
  '{x',
  '[1',
  '"',
  '""',
  'a"b',
  'x,y',
  'p;q',
  'a|b',
  '\t',
  '\r\n',
  '\r',
  '\n',
  '﻿',
);
const text = fc
  .oneof(trickyStrings, fc.string(), fc.string({ unit: 'binary' }))
  .filter((s) => !isContainerText(s));
const number = fc
  .oneof(fc.integer(), fc.double({ noNaN: true, noDefaultInfinity: true }))
  .filter((n) => !Object.is(n, -0));
const digits = (min: number, max: number) =>
  fc.string({ unit: fc.constantFrom(...'0123456789'), minLength: min, maxLength: max });
/** Big numbers (spec 015 §Terms) as RFC 8259 texts: long integers, long decimals, big exponents. */
const bigNumber = fc
  .oneof(
    fc
      .tuple(fc.constantFrom('', '-'), fc.constantFrom(...'123456789'), digits(15, 30))
      .map(([s, d, rest]) => `${s}${d}${rest}`),
    fc
      .tuple(fc.constantFrom('', '-'), digits(1, 3), digits(16, 30))
      .map(([s, whole, fraction]) => `${s}${String(Number(whole))}.${fraction}1`),
    fc
      .tuple(
        fc.constantFrom('', '-'),
        fc.integer({ min: 1, max: 9 }),
        fc.integer({ min: 309, max: 999 }),
      )
      .map(([s, d, e]) => `${s}${d}e${e}`),
  )
  .filter((t) => !isSafeNumber(t))
  .map((t) => new LosslessNumber(t));
const scalar = fc.oneof(text, number, bigNumber, fc.boolean(), fc.constant(null));

/** `rows` as import reads them back: a plain number written as a big number's text is that big
 *  number (B1, B9). */
function readBack(value: unknown): unknown {
  if (typeof value === 'number') {
    const written = JSON.stringify(value);
    return isSafeNumber(written) ? value : new LosslessNumber(written);
  }
  if (typeof value !== 'object' || value === null || value instanceof LosslessNumber) return value;
  if (Array.isArray(value)) return value.map(readBack);
  return objectOf(Object.entries(value).map(([k, v]) => [k, readBack(v)]));
}

type Shape = [string, string[] | null][];

const keys = (min: number) => fc.uniqueArray(key, { minLength: min, maxLength: 4 });
const shape: fc.Arbitrary<Shape> = keys(1).chain((names) =>
  fc.tuple(
    ...names.map((name) =>
      fc.option(keys(1), { nil: null }).map((sub) => [name, sub] as [string, string[] | null]),
    ),
  ),
);

/** An object with `names` as own keys, in order, `__proto__` included. */
function objectOf(entries: [string, unknown][]): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (const [name, value] of entries) {
    Object.defineProperty(object, name, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return object;
}

const rowOf = (s: Shape) =>
  fc
    .tuple(
      ...s.map(([, sub]) =>
        sub === null
          ? scalar
          : fc
              .tuple(...sub.map(() => scalar))
              .map((values) => objectOf(sub.map((n, i) => [n, values[i]]))),
      ),
    )
    .map((values) => objectOf(s.map(([name], i) => [name, values[i]])));

const data = shape.chain((s) => fc.array(rowOf(s), { minLength: 1, maxLength: 6 }));
const delimiter = fc.constantFrom<CsvDelimiter>(',', ';', '\t', '|');

function keyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(keyOrder);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).map(([k, v]) => [k, keyOrder(v)]);
  }
  return value;
}

describe('CSV round trip (spec 009 criterion 3)', () => {
  it(`csvToJson(jsonToCsv(data)) gives data back with no warnings: ${RUNS} runs, seed ${SEED}`, () => {
    fc.assert(
      fc.property(data, delimiter, fc.boolean(), fc.boolean(), (rows, d, bom, flattenObjects) => {
        const exported = jsonToCsv(rows, { delimiter: d, bom, flattenObjects });
        if (!('text' in exported)) throw new Error(exported.error.message);
        const imported = csvToJson(exported.text, { delimiter: d });
        if (!('data' in imported)) throw new Error(JSON.stringify(imported.error));
        expect(imported.warnings).toEqual([]);
        const expected = readBack(rows);
        expect(isDeepStrictEqual(imported.data, expected)).toBe(true);
        expect(keyOrder(imported.data)).toEqual(keyOrder(expected));
      }),
      { seed: SEED, numRuns: RUNS },
    );
    // About 5 s alone and more under a full parallel run; criterion 3 fixes the run count, so the
    // test gets time rather than fewer runs (as actions.test.ts does).
  }, 60_000);
});
