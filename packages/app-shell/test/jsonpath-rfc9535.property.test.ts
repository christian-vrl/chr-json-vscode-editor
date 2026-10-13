// Spec 014 criterion 4 (014 T2, fast-check, seed committed, 10 000 runs): for any data the 002
// formats can hold (JSON5 values, `-0`, `NaN`, `±Infinity`, any keys including `__proto__`, nesting
// to depth 64; 011's `identityData`), `$` gives `[data]`, `$.*` the data's array items or member
// values in order (`[]` for a scalar), and `$..*` as many values as the data has descendants. Every
// value in each result is `isDeepStrictEqual`, key order checked, to the value at its place (P2).
//
// `$..*`'s places are listed in json-p3's order: each visited node's children, the nodes visited
// depth first in document order. RFC 9535 §2.5.2.2 also allows other orders; a json-p3 upgrade
// re-runs this criterion (plan, Constraints).
import fc from 'fast-check';
import { expect, it } from 'vitest';
import { orderedEqual } from '../../../tests/query/query.js';
import { jsonpathRfc9535QueryLanguage } from '../src/query/jsonpath-rfc9535.js';
import { identityData } from './query-identity.js';

export const SEED = 20261013;
export const RUNS = 10_000;

const run = (data: unknown, query: string) =>
  jsonpathRfc9535QueryLanguage.executeQuery(data, query, JSON) as unknown[];

/** An array's items or an object's own member values, in order; none for a scalar. */
const children = (value: unknown): unknown[] =>
  value !== null && typeof value === 'object' ? Object.values(value) : [];

/** The values `$..*` selects: the children of the data and of each descendant, depth first. */
function descendants(value: unknown): unknown[] {
  const own = children(value);
  return [...own, ...own.flatMap(descendants)];
}

/** Whether the result lists exactly these values, each the data's own and in order. */
const sameValues = (result: unknown[], expected: unknown[]) =>
  result.length === expected.length &&
  result.every((value, i) => Object.is(value, expected[i]) && orderedEqual(value, expected[i]));

it(`$, $.* and $..* give the data's own values, ${RUNS} runs, seed ${SEED}`, () => {
  fc.assert(
    fc.property(identityData, (data) => {
      expect(sameValues(run(data, '$'), [data])).toBe(true);
      expect(sameValues(run(data, '$.*'), children(data))).toBe(true);
      expect(sameValues(run(data, '$..*'), descendants(data))).toBe(true);
    }),
    { seed: SEED, numRuns: RUNS },
  );
}, 300_000);
