// Spec 011 criterion 3 (011 T3): for any data the 002 formats can hold, the identity query returns
// data equal to the input under `isDeepStrictEqual` with key order checked, in both languages
// (fast-check, seeds committed, 10 000 runs per language). Each run is a fresh engine (spec Terms),
// and Lodash's source takes about 16 ms to compile in each, so the Lodash runs are split over
// query-identity.lodash-<n>.test.ts files that Vitest runs in parallel, each with its own seed.
import fc from 'fast-check';
import { expect, it } from 'vitest';
import { dataArbitrary } from '../../core/test/arbitraries.js';
import { orderedEqual } from '../../../tests/query/query.js';
import { loadQueryEngine, runQuery, type QueryLanguageId } from '../src/query/run-query.js';

export const SEED = 20261011;
export const RUNS = 10_000;
export const LODASH_SHARDS = 4;
export const IDENTITY_QUERY = 'function query (data) {\n  return data\n}';

/** An own enumerable member, `__proto__` included. */
function withMember(key: string, value: unknown): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return object;
}

/** A value nested 1 to 64 levels deep in arrays and objects (any keys, `__proto__` included). */
const deep = fc
  .tuple(
    fc.array(fc.option(fc.oneof(fc.constant('__proto__'), fc.string()), { nil: undefined }), {
      minLength: 1,
      maxLength: 64,
    }),
    fc.oneof(
      fc.constantFrom(-0, NaN, Infinity, -Infinity, null, true, 0, '', '\ud800'),
      dataArbitrary('json5'),
    ),
  )
  .map(([levels, leaf]) =>
    levels.reduceRight<unknown>(
      (inner, key) => (key === undefined ? [inner] : withMember(key, inner)),
      leaf,
    ),
  );

/** JSON5 values (`-0`, `NaN`, `±Infinity`, any keys), and nesting to depth 64. */
export const identityData: fc.Arbitrary<unknown> = fc.oneof(dataArbitrary('json5'), deep);

/** Registers one property test: `runs` runs of the identity query in `language` from `seed`. */
export function identityProperty(language: QueryLanguageId, seed: number, runs: number): void {
  it(`${language}: the identity query returns its input, ${runs} runs, seed ${seed}`, async () => {
    await loadQueryEngine(() => import('../src/query/engine.js'));
    fc.assert(
      fc.property(identityData, (data) => {
        const result = runQuery(language, data, IDENTITY_QUERY);
        expect(orderedEqual(result, data)).toBe(true);
      }),
      { seed, numRuns: runs },
    );
  }, 300_000);
}
